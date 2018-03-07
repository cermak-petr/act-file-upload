const _ = require('lodash');
const Apify = require('apify');
const request = require('request-promise');

const testStore = {};
const CV_FILE_URL = 'https://trello-attachments.s3.amazonaws.com/5937edf10b8c6f7c1dd28f57/5a745fc5c66aee87c0551c69/5b2e7061098263177b416041a03fc542/CV_Mavimi.pdf';
const LETTER = 'Dobrý den,\njsem z projektu Mavimi, který by Vám mohl pomoct obsadit tuto nebo i jinou pozici. Máme v databázi přes 5000 žen, které hledají práci většinou na částečný úvazek. Zaregistrujte se na www.mavimi.cz a zkuste si najít tu pravou pro Vaši pozici. Nyní je vše zdarma.\nHezký den.\nMonika Hromasová';
const FORM_DATA = { 
    'jobad_application[coverLetter]': LETTER,
    'jobad_application[fileFirst]': {
        value: '', options: {filename: '', contentType: 'application/octet-stream'}
    },
    'jobad_application[fileSecond]': {
        value: '', options: {filename: '', contentType: 'application/octet-stream'}
    },
    'jobad_application[fileThird]': {
        value: '', options: {filename: '', contentType: 'application/octet-stream'}
    },
    'jobad_application[firstName]': 'Monika',
    'jobad_application[surname]': 'Hromasová',
    'jobad_application[email]': 'monika@mavimi.cz',
    'jobad_application[phone]': '+420603172858',
    'jobad_application[lastSearchUrl]': '',
    'jobad_application[_token]': '',
    'jobad_application[acceptTerms]': 1,
    'jobad_application[lmcTermsAccepted]': 1,
    'sendApply': 'submit'
}

async function loadClientCompanies(){
    return await request({
        json: true,
        method: 'get',
        uri: 'https://mavimi.cz/app/api/getCompanies?api_key=a997a569-8a6b-4441-a40d-81d595d9861b'
    });
}

async function loadCrawlerResults(execId, process){
    const limit = 15000;
    let total = -1, offset = 0;
    while(total === -1 || offset + limit <= total){
        const fullResults = await Apify.client.crawlers.getExecutionResults({
            executionId: execId,
            limit: limit, 
            offset: offset,
            simplified: 1,
            hideUrl: 1
        });
        const results = _.chain(fullResults.items).flatten().value();
        await process(results);
        total = fullResults.total;
        offset += limit;
    }
}

function findMatch(result, companies){
    for(const company of companies){
        if(result.companyName.indexOf(company.companyName) > -1){
            return company;
        }
    }
    return null;
}

function dayDiff(t1, t2){
    return parseInt((t2 - t1)/(24*3600*1000));
}

async function updateSentRecord(key, prevRecord){
    return await Apify.client.keyValueStores.putRecord({
        key: key, 
        contentType: 'application/json',
        body: JSON.stringify({
            date: Date.now(),
            tries: prevRecord ? prevRecord.tries + 1 : 1
        })
    });
    /*testStore[key] = {
        date: Date.now(),
        tries: prevRecord ? prevRecord.tries + 1 : 1
    };*/
}

async function sendForm(result, fileData, page){
    const url = 'https://www.jobs.cz/jof/' + result.offerId + '/';
    const offerPage = await request(url);
    const token = offerPage.match(/jobad_application__token(?:.*?)value="([a-zA-Z0-9\-_]+)/);
    if(!token){throw new Error('Unable to find application token for offer: ' + url);}
    
    await page.goto(url);
    await page.waitForSelector('#sendApply');

    await page.evaluate((formData) => {
        document.querySelector('#jobad_application_coverLetter').value = formData['jobad_application[coverLetter]'];
        document.querySelector('#jobad_application_firstName').value = formData['jobad_application[firstName]'];
        document.querySelector('#jobad_application_surname').value = formData['jobad_application[surname]'];
        document.querySelector('#jobad_application_email').value = formData['jobad_application[email]'];
        document.querySelector('#jobad_application_phone').value = formData['jobad_application[phone]'];
    }, FORM_DATA);
    
    const fileInput = await page.$('#jobad_application_fileFirst');
    await fileInput.uploadFile('./CV_Mavimi.pdf');
    
    await page.evaluate(() => {
        document.querySelector('#sendApply').click();
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return null;
}

function createKey(companyName){
    return companyName.normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-1]/g, '-');
}

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    const cComp = await loadClientCompanies();
    const stores = Apify.client.keyValueStores;
    const sentStore = await stores.getOrCreateStore({storeName: 'mavimi-sent'});
    Apify.client.setOptions({ storeId: sentStore.id });
    
    const pdfData = await request({uri: CV_FILE_URL, encoding: null});
    await Apify.setValue('CV mavimi.pdf', pdfData, {contentType: 'application/pdf'});
    
    const browser = await Apify.launchPuppeteer();
    const page = await browser.newPage();
    
    /*await loadCrawlerResults(input._id, async (results) => {
        try{
            let index = 0;
            for(const result of results){
                const match = findMatch(result, cComp);
                if(!match){
                    const key = createKey(result.companyName);
                    console.log(key);
                    //const sentRecord = await stores.getRecord({key: key});
                    const sentRecord = testStore[key];
                    if(sentRecord){
                        const days = dayDiff(Date.now(), sentRecord.date);
                        if(days > 14 && sentRecord.tries < 2){
                            //await sendForm(result, pdfData);
                            await updateSentRecord(key, sentRecord);
                            if(++index > 100){break;}
                        }
                    }
                    else{
                        //await sendForm(result, pdfData);
                        await updateSentRecord(key);
                        if(++index > 100){break;}
                        await Apify.pushData({
                            companyName: result.companyName,
                            offerUrl: 'https://www.jobs.cz/rpd/' + result.offerId + '/',
                            offerId: result.offerId
                        });
                    }
                }
            }
        }
        catch(e){console.log(e);}
    });*/
    
    try{
        const resp = await sendForm({offerId: '1272508170'}, pdfData, page);
        //await Apify.setValue('response.html', resp, {contentType: 'text/html'});
        
        console.log('Saving screenshot 1...');
        const screenshotBuffer1 = await page.screenshot();
        await Apify.setValue('screenshot_1.png', screenshotBuffer1, { contentType: 'image/png' });
    }
    catch(e){console.log(e);}
    
    await Apify.setValue('OUTPUT', cComp);
});
