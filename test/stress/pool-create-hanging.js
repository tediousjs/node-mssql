/**
 * Test case for figuring out robust way to recognize if connection is dead
 * for mysql based drivers.
 */
const toxiproxy = require('toxiproxy-node-client');
const toxicli = new toxiproxy.Toxiproxy('http://localhost:8474');
const rp = require('request-promise-native');
const _ = require('lodash');

const mssql = require('../../' + process.env.TEST_DRIVER);
const debug = require('debug')('mssql-stress');

function delay(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms);
  })
}

function cloneDeep(val) {
  return JSON.parse(JSON.stringify(val)); 
}

// initial dummy object, which will be overridden by connection process
let mssqlCon = { connected: false };
let connectionNumber = 0;

async function mssqlQuery(sql) {
  // recreate connection is not connected / connecting stus
  if (!mssqlCon.connected && !mssqlCon.connecting) {
    debug('========== Reconnecting mssql');

    // this test needs toxiproxy to run so docker mssql is also required
    mssqlCon = new mssql.ConnectionPool({
      port: 21433,
      user: "sa",
      password: "S0meVeryHardPassword",
      server: "localhost",
      requestTimeout: 5000,
      connectionTimeout:7000,
      debug: true,
      pool: {
        debug: true,
        min: 1,
        max: 1,
        acquireTimeoutMillis: 10000,
        testOnBorrow: true
      }
    });

    mssqlCon.connectionNumber = connectionNumber += 1;

    // NOTE: this never seems to fire
    mssqlCon.on('error', err => {
      debug('There was fatal connection error %O', err);
    });

    debug('Waiting for connection');
    await mssqlCon.connect();
  }

  debug('>>>>>>>>>>>>>>>> Running query >>>>>>>>>>>>>>>');
  debug('%o', {
    peding: mssqlCon.pool.pending,
    size: mssqlCon.pool.size,
    available: mssqlCon.pool.available,
    spareResourceCapacity: mssqlCon.pool.spareResourceCapacity,
    borrowed: mssqlCon.pool.borrowed,
  });
  const res = await mssqlCon.request().query(sql);
  debug('query response %o', res.recordset);
  debug('<<<<<<<<<<<<<<<<< query  done <<<<<<<<<<<<<<<<');
  return res;
}

// setup counters to check queries / results / errors made since last report
const counters = {};
function setQueryCounters(name) {
  const counts = counters[name] = {queries: 0, results: 0, errors: 0};
}
setQueryCounters('mssql');

// start printing out counters
let lastCounters = cloneDeep(counters);
let hangRounds = 0;
let statsInterval = setInterval(() => {
  const reqsPerSec = {};
  for (let key of Object.keys(counters)) {
    reqsPerSec[key] = {
      queries: (counters[key].queries - lastCounters[key].queries),
      results: (counters[key].results - lastCounters[key].results),
      errors: (counters[key].errors - lastCounters[key].errors),
    }
  }

  console.log('------------------------ REQUESTS SINCE LAST PRINT ------------------------');
  if (mssqlCon.pool) {
    console.dir({
      peding: mssqlCon.pool.pending,
      size: mssqlCon.pool.size,
      available: mssqlCon.pool.available,
      borrowed: mssqlCon.pool.borrowed,
    });
  }
  console.dir(reqsPerSec, { colors: true });
  console.log('------------------------------------ EOS ---------------------------------');
  lastCounters = cloneDeep(counters);

  if (reqsPerSec.mssql.queries === 0) {
    hangRounds++;
  } else {
    hangRounds = 0;
  }

  if (hangRounds === 3) {
    console.log('Driver did hang exit with error');
    process.exit(1);
  }
}, 500);

/**
 * Kill old proxy instance and its connections if found and create new
 * proxy waiting for connections.
 */
async function recreateProxy(serviceName, listenPort, proxyToPort) {
  try {
    await rp.delete({
      url: `${toxicli.host}/proxies/${serviceName}`
    });
  } catch(err) {}

  const proxy = await toxicli.createProxy({
    name: serviceName,
    listen: `0.0.0.0:${listenPort}`,
    upstream: `${serviceName}:${proxyToPort}`
  });

  // add some network latency simulation
  await proxy.addToxic(new toxiproxy.Toxic(proxy, {
    type: 'latency',
    attributes: {latency: 1, jitter: 1}
  }));

  // cause connections to be closed every some transferred bytes
  await proxy.addToxic(new toxiproxy.Toxic(proxy, {
    type: 'limit_data',
    attributes: {bytes: 5000}
  }));
}

async function main() {
  await recreateProxy('mssql', 21433, 1433);
  // break connections every second
  let connectionKillerInterval = setInterval(() => recreateProxy('mssql', 21433, 1433), 1000);

  // loop queries and log any errors thrown
  function loopQueries(prefix, query) {
    const counts = counters[prefix];
    let keepOnSwimming = true;

    async function asyncQueryLoopRun() {
      while(keepOnSwimming) {
        try {
          counts.queries += 1;
          await query();
          counts.results += 1;
        } catch (err) {
          counts.errors += 1;
          debug('%s %O', prefix, err);
        }
      }  
    }

    let loopPromise = asyncQueryLoopRun();

    return () => {
      keepOnSwimming = false;
      return loopPromise;
    };
  }

  killQueryLoop = loopQueries('mssql', () => mssqlQuery('select 1 as number'));

  // should fail in few seconds
  await delay(10000);

  console.log('killing loop');
  clearInterval(connectionKillerInterval);
  clearInterval(statsInterval);
  await killQueryLoop();
  mssqlCon.close();
}

main().then(() => console.log('TEST DONE EXIT SUCCESS')).catch(err => console.log('TEST FAIL WITH ERROR %O', err));
