#!/usr/bin/env node
'use strict';

const CronJob = require('cron').CronJob;
const request = require('request');
const nasync = require('async');
const debug = require('debug')('ddclient');
const config = require('./config');

const CF_API = 'https://www.cloudflare.com/api_json.html';

/*
 * Use getIp in config to setup remote host which provide get current ip service
 */
function getIp(cb) {
  let serv = (config.getIp) ? config.getIp : 'http://ifconfig.me/ip';

  request.get(serv, function(err, req, body) {
    if (err) {
      console.error('getIp fail!');
      cb(err);
    } else {
      let addr = body.replace(/\n/g, '');
      debug('getIp', addr);
      cb(null, addr);
    }
  });
}

/*
 * Filter dns data and return target submain data
 * Always save full data so need a simple way to extract target subdomain data
 */
function getSubdomain(obj) {
  if (typeof(obj) !== 'object') return false;
  let result = [], subdomains = config.cloudflare.subdomain;

  if (obj.response &&
      obj.response.recs &&
      obj.response.recs.objs &&
      obj.response.recs.count &&
      obj.response.recs.count > 0) {

      let items = obj.response.recs.objs;
      items.forEach(function(item) {
        if (subdomains.indexOf(item.name) !== -1) {
          result.push(item);
        }
      });
  }
  debug('getSubdomain', result);
  return result;
}

/*
 * Fetch dns data from service provicer
 */
function getDnsInfo(cb) {
  var param = config.cloudflare;
  request.get(CF_API, {
    method: 'GET',
    qs: {
      a: 'rec_load_all',
      tkn: param.apikey,
      email: param.email,
      z: param.domain
    },
    json: true
  }, function(err, res, body) {
    return (err) ? cb(err) : cb(null, body);
  });
}

/*
 * update dns data at service provider
 */
function updateDnsInfo(dns, cb) {
  var param = config.cloudflare;
  debug('updateDnsInfo', dns);

  request(CF_API, {
    method: 'POST',
    form: {
      a: 'rec_edit',
      tkn: param.apikey,
      email: param.email,
      z: param.domain,
      type: 'A',
      name: dns.subdomain,
      id: dns.id,
      content: dns.content,
      service_mode: '0',
      ttl: '1'
    },
    json: true
  }, function(err, res, body) {
    return (err) ? cb(err) : cb(null, body);
  });
}

/*
 * main function
 */
let job = new CronJob(config.cronRule, function() {
  nasync.parallel([
    nasync.apply(getIp),
    nasync.apply(getDnsInfo)
  ], function(err, results) {
    if (err) {
      console.error(err);
    } else {
      debug('Prepare for DNS update', results);
      let addr = results[0];
      let subdomains = getSubdomain(results[1]);

      nasync.timesSeries(subdomains.length, function(n, next){
        let dns = subdomains[n];
        if (!dns['rec_id']) {
          next(null, `${dns.name} format error`);
        } else if (addr === dns.content) {
          next(null, `${dns.name} don't need to update ip now`);
        } else {
          let update = {
            id: dns.rec_id,
            content: addr,
            subdomain: dns.name
          };
          updateDnsInfo(update, function(err, data) {
            if (err || data.result != 'success') {
              let message = `Update ${dns.name} DNS data fail`;
              console.error(err, data, message);
              next(message);
            } else {
              next(err, `Update ${dns.name} to ${addr}`);
            } 
          });
        }
      }, function(err, result){
        if (err) {
          console.error(err);
        } else {
          debug('ddclient finish', result.join(';'));
          console.log(result.join("\n"));
        }
      });
    }
  });
}, null, true);

// start as cronjob
job.start();
