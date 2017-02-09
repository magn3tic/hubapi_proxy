if(process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './config/.env' });
}
  
const express = require('express');
const request = require('request');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 1337;
const hubSecret = process.env.HUBSPOTSECRET;
const server = app.listen(port);
const middleware = require('./middleware');
const getDeals = middleware.getDeals;
const readJSONFile = middleware.readJSONFile;
const getCompanyIdsByDeals = middleware.getCompanyIdsByDeals;
const getCompaniesInit = middleware.getCompaniesInit;
const hubAuth = middleware.hubAuth;
const cors = require('cors');
const https = require('https');
// Hub constants
const hubAPI = process.env.HUBAPIBASE;
const hubAuthToken = process.env.HUBOAUTHTOKEN;
const clientID = process.env.HUBCLIENTID;
const clientSecret = process.env.HUBCLIENTSECRET;
const hubAuthInit = process.env.HUBAUTHINIT;
const callbackURL = process.env.CALLBACKURL;
const HUBCONTACTSALL = process.env.HUBCONTACTSALL;
const HUBCOMPANIESALL = process.env.HUBCOMPANIESALL;
const HUBGETCOMPANY = process.env.HUBGETCOMPANY;
const HUBDEALSALL = process.env.HUBDEALSALL;
const HUBDEAL = process.env.HUBDEAL;
const HUBME = process.env.HUBME;
const HUBFORMID = process.env.HUBFORMID;
const HUBPORTALID = process.env.HUBPORTALID;

// Server Env. To share with others switch to 'staging'
// const serverEnv = 'dev';
const serverEnv = 'staging';

// Limit api calls to hubspot to adhere to limitaions(10 requests per second)
const limit = require("simple-rate-limiter");
const callAPI = limit(require("request")).to(10).per(1000);

// Passport
var passport = require('passport')
var OAuth2Strategy = require('passport-oauth').OAuth2Strategy;
const Qs = require('qs');
const bodyParser = require('body-parser');

const _ = require('lodash');

server.on('listening', () =>
  console.log(`express proxy application started on ${port}`)
);

app.options('*', cors())
  .use(cors());

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.route('/hubAPI/refresh')
  .get((req, res) => {
    getDeals()
      .then(result => res.send(result))
      .catch(err => console.log('err: ', err))
  });

// This route and its functions should be abstracted into services/middleware when going to prod
app.route('/hubAPI')
  .post((req, res, next) => {
    // readJSONFile('./data/companies.json')
    //   .then(json => res.send(json))
    //   .catch(err => console.error(err))
    console.log('req: ', req.body.variable_name);

  })

app.route('/contact')
  .post((req, res) => {
    return new Promise((resolve, reject) => {
      if (!req.body) {
        console.log('no body');
      } else {
        const userEmail = req.body.email;
        const contactPath = hubAPI + `contacts/v1/contact/email/${userEmail}/profile`;
        // console.log('contactPath: ', contactPath);
        let token = req.body.authorization;
        let options = {
          url: contactPath,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `${token}`,
            'User-Agent': 'request',
            Accept: 'application/json',
          }
        }
        // console.log('options: ', options)
        request(options, (error, response, body) => {
          if (!error) {
            // console.log('body: ', body);
            res.status(200).send(body)
          } else {
            console.log('error: ', error);
            reject('user contact error: ', err);
          }
        });
      }
    })
  })

app.route('/hubContacts')
  .post((req, res) => {
    if (fs.existsSync(__dirname + '/data/contacts.json')) {
      console.log('contacts.json already exists, sending file');
      res.status(200).send(fs.readFileSync(__dirname + '/data/contacts.json'));
      return
    }
    // console.log('req bearer: ', req.body.authorization[0]);
    let token = req.body.authorization[0];
    let vidOffset = '';
    let options = {
      url: hubAPI + HUBCONTACTSALL + '?contacts=100',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${token}`,
        'User-Agent': 'request',
        Accept: 'application/json',
      }
    }

    let contacts = [];
    var callback = (error, response, body) => {
      return new Promise((resolve, reject) => {
        let hasMore = body['has-more'];
        var info = JSON.parse(body);
        if (!error && response.statusCode == 200) {
          contacts.push(info);
          // console.log('successful callback to get contacts, contacts: ', contacts);
          setTimeout(function () {
            vidOffset = info['vid-offset'];
            hasMore = info['has-more'];
            options.url = hubAPI + HUBCONTACTSALL + '?contacts=100' + '&vidOffset=' + vidOffset;
            console.log('in callback new vidOffset: ', options.url);
            console.log('hasMore: ', hasMore);
            if (!hasMore) {
              console.log('!hasMore: ', hasMore);
              contacts.push(info);
              fs.writeFile(__dirname + '/data/contacts.json', JSON.stringify(contacts), err => {
                if (err) {
                  reject(err => console.log('err in writeFile with contacts'));
                }
                readJSONFile(__dirname + '/data/contacts.json')
                  .then(json => resolve(res.send(json)))
                  .catch(err => reject(console.log('file written err: ', err)))
              })
            }
            return request(options, callback);
          }, 100);
        } else {
          reject(res.sendStatus(404))
        }
      })
    }
    request(options, callback)
  })


app.route('/hubToken')
  .get((req, res) => {
    // console.log('request for hubspot_token route /hubToken', req.route);
    if (fs.existsSync('./data/token.json')) {
      readJSONFile('./data/token.json')
        .then((json) => {

          res.send(json)})
        .catch(err => console.error('hubToken err readJSONFile: ', err));
    } else {
      res.status(404).send('Not authorized, no token in data/token.json')
    }
  })

app.route('/hubLogout')
  .get((req, res) => {
    console.log('logout requested');
    fs.unlink(__dirname + '/data/token.json', (err) => {
      if (err && err.code === 'ENOENT') {
        console.log('unlink err: ENOENT ', err);
        res.sendStatus(204);
      } else {
        console.log('successfully logged out');
        res.sendStatus(200);
      }
    })
  })

app.get('/hubAuth', passport.authenticate('hubspot', { session: false, scope: ['contacts'] }), (err, req, res) => {
  console.log('im being used!');
  if (!err) {
    console.log('initial success');
  } else {
    console.log('/hubAuth err: ', err);
  }
});

app.get('/auth/hubspot/callback', passport.authenticate('hubspot', { session: false }), (req, res) => {
  if (req.user) {
    // Save req.user to a local json file to cache
    fs.writeFile('data/token.json', JSON.stringify(req.user), err => {
      if (err) throw err;
      console.log('saved token: ', JSON.parse(fs.readFileSync('data/token.json')));
      res.redirect(303, (serverEnv === 'dev') ? 'http://localhost:3000/#/token' : 'http://mag.surge.sh/#/token');
    });
  } else {
    console.log('callback err: ', err);
  }
}
);

//Dev information can be accessed here: https://app.hubspot.com/developers-beta/2313987/application/38196
passport.use('hubspot', new OAuth2Strategy({
  authorizationURL: hubAuthInit,
  tokenURL: hubAPI + hubAuthToken,
  clientID,
  clientSecret,
  callbackURL
},
  function (accessToken, refreshToken, profile, done) {
    var authInfo = {
      accessToken,
      refreshToken
    }
    request('https://app.hubspot.com/oauth/authorize/' + accessToken, function (error, response, body, authInfo) {
      if (!error) {
        console.log('successful Oauth 2.0 connection')
        return done(null, this.authInfo);
      } else {
        return done(error);
      }
    }.bind({ authInfo }))
  }
));

app.post('/hubDeals', (req, res) => {
  console.log('req bearer: ', req.body.authorization[0]);
  let token = req.body.authorization[0];
  let offset = '';
  let options = {
    url: hubAPI + HUBDEALSALL + '?limit=250',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token}`,
      'User-Agent': 'request',
      Accept: 'application/json',
    }
  }

  let deals = [];
  let tempDealIDsArray = [];
  var callback = (error, response, body) => {
    return new Promise((resolve, reject) => {
      let hasMore = body['has-more'];
      var info = JSON.parse(body);
      if (!error && response.statusCode == 200) {
        deals.push(info);
        console.log('successful callback to get deals, deals: ', deals);
        setTimeout(function () {
          offset = info['offset'];
          hasMore = info['has-more'];
          options.url = hubAPI + HUBDEALSALL + '?includeAssociations=true&properties=dealname&limit=250&offset=' + offset;
          console.log('options.url: ', options.url);
          if (!hasMore) {
            fs.writeFile(__dirname + '/data/deals.json', JSON.stringify(deals), err => {
              if (err) {
                reject(err => console.log('err in writeFile with deals'));
              }
              readJSONFile(__dirname + '/data/deals.json')
                .then(json => {
                  const dealsObj = JSON.parse(json);
                })
                .catch(err => reject(console.log('file written err: ', err)))
            })
          }
          return request(options, callback);
        }, 100);
      } else {
        reject(res.sendStatus(404))
      }
    })
  }
  request(options, callback)
})

app.post('/hubDeal/:id', (req, res) => {
  console.log('req bearer: ', req.body.authorization[0]);
  let token = req.body.authorization[0];
  let offset = '';
  let options = {
    url: hubAPI + HUBDEAL + req.params.id + '?limit=250',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token}`,
      'User-Agent': 'request',
      Accept: 'application/json',
    }
  }

  var callback = (error, response, body) => {
    return new Promise((resolve, reject) => {
      var info = JSON.parse(body);
      if (!error && response.statusCode == 200) {
        resolve(res.status(200).send(info));
      } else {
        reject(res.sendStatus(404))
      }
    })
  }
  request(options, callback)
})

app.route('/hubMe')
  .post((req, res) => {
    console.log('req.headers: ', req.headers);
    let token = req.headers.authorization.replace('Bearer ', '');
    console.log('/hubMe token: ', token)
    let options = {
      url: hubAPI + HUBME + token,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${token}`,
        'User-Agent': 'request',
        Accept: 'application/json',
      }
    }

    var callback = (error, response, body) => {
      console.log('hubme callback body: ', body);
      return new Promise((resolve, reject) => {
        var info = JSON.stringify(body);
        if (!error && response.statusCode == 200) {
          resolve(res.status(200).send(info));
        } else {
          reject(res.sendStatus(404))
        }
      })
    }
    request(options, callback)
  })

app.route('/hubCompanies')
  .post((req, res) => {
    if (fs.existsSync(__dirname + '/data/companies.json')) {
      console.log('companies.json already exists, sending file');
      res.status(200).send(fs.readFileSync(__dirname + '/data/companies.json'));
      return
    }
    console.log('req bearer: ', req.body.authorization[0]);
    let token = req.body.authorization[0];
    let offset = '';
    let options = {
      url: hubAPI + HUBCOMPANIESALL,
      json: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${token}`,
        'User-Agent': 'request',
        Accept: 'application/json',
      }
    }

    let companies = [];
    var callback = (error, response, body) => {
      if (!body) {
        // console.log('no body in response, response: ', response);
        // console.log('no body: ', body);
      }
      return new Promise((resolve, reject) => {
        let hasMore = body['has-more'];
        try {
          var data = body;
        } catch (e) {
          console.log('malformed request', e);
          return res.status(400).send('malformed request: ' + body);
        }
        // console.log('data: ', data);
        if (!error && response.statusCode == 200) {
          companies.push(data);
          setTimeout(function () {
            offset = data['offset'];
            hasMore = data['has-more'];
            options.url = hubAPI + HUBCOMPANIESALL + '?properties=lifecyclestage&properties=hubspot_owner_id&properties=hs_lead_status' + '&offset=' + offset;
            let tempCompaniesArr = [];
            let companyIDsArr = [];
            if (!hasMore) {
              companies.push(data);
              const flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
              _.forEach(companies, (val, key) => {
                tempCompaniesArr.push(val.companies)
              })
              tempCompaniesArr = flatten(tempCompaniesArr);
              const opportunityCompanies = _.chain(tempCompaniesArr).filter((o) => {
                if (!o) {
                  return;
                }
                return o.properties.lifecyclestage;
              })
                .map('companyId')
                .value();

              getCompaniesInit(opportunityCompanies, options)
                .then(companies => {
                  // console.log('getCompanies returned: ', companies)
                  fs.writeFile(__dirname + '/data/companies.json', companies, err => {
                    if (err) {
                      reject(err => console.log('error writing companies.json: ', err));
                    }
                    readJSONFile(__dirname + '/data/companies.json')
                      .then(json => resolve(res.json(json)))
                      .catch(err => reject(console.log(err)))
                  })
                })
                .catch(err => console.log('getCompanies err: ', err))

            }
            return request(options, callback);
          }, 100);
        } else {
          reject(res.sendStatus(404))
        }
      })
    }
    request(options, callback)
  })


// this route is not being used currently since hubspot can't find the properties in question.

app.route('/hubDeleteProps')
  .post((req, res) => {
    let token = req.headers.authorization;
    console.log('/hubDeleteProps token: ', token);
    // headers
    let index = 0;
    let options = {
      json: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${token}`,
        'User-Agent': 'request',
        Accept: 'application/json',
      }
    }
    let headers = options.headers;
    console.log('req bearer: ', req.body.token);
    const propertiesToBeDeleted = req.body;
    _.forEach(propertiesToBeDeleted, (property) => {
      index++
      if (!property.startsWith('scope')) {
        return
      } else {
        callAPI({ url: hubAPI + HUBCONTACTSALL + property, headers }, (error, response, body) => {
          console.log('callAPI returned: ', body);
          if (error) {
            console.log('error: ', error);
          } else {
            if (index === propertiesToBeDeleted.length) {
              res.sendStatus(200);
            }
          }
        })
        console.log('property: ', property);
      }
    })
  })

app.route('/hubFormsPurge')
  .post((req, res) => {
    // build the data object
    const scopes = encodeURI(JSON.stringify([]));
    const email = req.body.email;
    // build the data object
    // var postData = `email=${req.body.email}&scopes=${scopes}`;
    let postData = Qs.stringify({
      email,
      scopes
    });

    console.log('postdata: ', postData);

    // set the post options, changing out the HUB ID and FORM GUID variables.
    var options = {
      hostname: 'forms.hubspot.com',
      path: `/uploads/form/v2/${HUBPORTALID}/${HUBFORMID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    }

    // set up the request
    var request = https.request(options, function (response) {
      console.log("Status: " + response.statusCode);
      if(response.statusCode >= 200 && response.statusCode <= 300){
        res.sendStatus(200);
      }
      console.log("Headers: " + JSON.stringify(response.headers));
      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        console.log('Body: ' + chunk)
      });
    });

    request.on('error', function (e) {
      console.log("Problem with request " + e.message)
    });

    // post the data
    request.write(postData);
    request.end();

  })

app.route('/hubFormsUpdate')
  .post((req, res) => {
    console.log('update req: ', req);
    const scopes = encodeURI(JSON.stringify(req.body.scopes));
    const email = req.body.email;
    // build the data object
    // var postData = `email=${req.body.email}&scopes=${scopes}`;
    let postData = Qs.stringify({
      email,
      scopes
    })

    console.log('postdata: ', postData);

    // set the post options, changing out the HUB ID and FORM GUID variables.
    var options = {
      hostname: 'forms.hubspot.com',
      path: `/uploads/form/v2/${HUBPORTALID}/${HUBFORMID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': postData.length
      }
    }

    // set up the request
    var request = https.request(options, function (response) {
      console.log("Status: " + response.statusCode);
      console.log("Headers: " + JSON.stringify(response.headers));
      if(response.statusCode >= 200 && response.statusCode <= 300){
        console.log('success conditional hit status: ', response.statusCode);
        res.sendStatus(200);
      }
      response.setEncoding('utf8');
      response.on('data', function (chunk) {
        console.log('Body: ' + chunk)
      });
    });

    request.on('error', function (e) {
      console.log("Problem with request " + e.message)
    });

    // post the data
    request.write(postData);
    request.end();

  })
