'use strict';

var fs = require('fs');
var http = require('http');
var _ = require('lodash');
var mongo = require('mongoskin');
var mongoCursorProcessing = require('mongo-cursor-processing');
var mongoOplog = require('mongo-oplog');
var Timestamp = require('bson-timestamp');
var redis = require('redis');
var Processor = require('./processor');
var defaultOptions = require('./default-options');

class Listener {

  constructor(options) {
    this.options = _.merge(_.cloneDeep(defaultOptions), options);
    this.processor = new Processor(options);
    this.processor.setDocGetter((id, done) => {
      this.collection().findOne(id, done);
    });
  }

  start() {
    var options = { ns: this.options.mongo.db + '.' + this.options.mongo.collection };
    this.getLastOpTimestamp((err, since) => {
      if (err) {
        console.log('error reading lastop: ' + err);
      }
      if (since) {
        options.since = since;
      }
      if (options.since) {
        console.log('resuming from timestamp ' + since);
      } else {
        console.log('unable to determine last op');
        if (!this.options.skipFullUpsert) {
          console.log('unable to determine last op, processing entire collection...');
          this.processEntireCollection();
        }
      }

      var oplog = this.oplog = options.oplog || mongoOplog(this.options.mongo.uri, options);

      oplog.on('op', (data) => {
        if (data.ns !== options.ns) {
          return;
        }
        this.processor.processOp(data, (err) => {
          if (err) {
            console.error('error processing op:', data);
            console.error(err);
          }
        });
        if (data && data.ts) {
          this.setLastOpTimestamp(data.ts);
        }
      });

      oplog.on('error', (error) => {
        console.error(error);
      });

      oplog.on('end', () => {
        console.log('Stream ended');
      });

      oplog.stop(() => {
        console.log('server stopped');
      });

      oplog.tail();

      this.startHttpServer();
    });
  }

  setLastOpTimestamp(ts) {
    if (this.options.redisLastOp) {
      if (!this.redisClient) {
        this.redisClient = redis.createClient(this.options.redisLastOp.url);
      }
      this.redisClient.set(this.options.redisLastOp.key, ts.toString());
      return;
    }
    fs.writeFileSync('lastop.json', ts.toString());
  }

  startHttpServer() {
    if (!this.options.http || !this.options.http.port) {
      return;
    }
    var port = this.options.http.port;
    this.httpServer = http.createServer(function(req, res){
      res.send('Hi!, I\'m the product catalog listener');
      res.end();
    });
    this.httpServer.listen(port);
    console.log('server listening at http://localhost:' + port);
  }

  getLastOpTimestamp(done) {
    var ts;
    function readFromFile() {
      if (fs.existsSync('lastop.json')) {
        try {
          ts = Timestamp.fromString(fs.readFileSync('lastop.json').toString());
        } catch(err) {
          console.error('error reading lastop file', err.toString());
        }
      }
      done(null, ts);
    }

    if (this.options.redisLastOp) {
      try {
        if (!this.redisClient) {
          this.redisClient = redis.createClient(this.options.redisLastOp.url);
          this.redisClient.on('error', (err) => {
            console.error('Redis client error', err.toString());
          });
        }
        this.redisClient.get(this.options.redisLastOp.key, (err, value) => {
          if (err) {
            return done(err);
          }
          if (value) {
            try {
              ts = Timestamp.fromString(value.toString());
            } catch(err) {
              console.error('error reading lastop redis key', err.toString());
            }
          }
          done(null, ts);
        });
        return;
      } catch(err) {
        return done(err);
      }
    }

    readFromFile();
  }

  collection() {
    if (!this.readerDb) {
      this.readerDb = mongo.db(this.options.mongo.uriEntireCollectionRead + '/' + this.options.mongo.db);
    }
    return this.readerDb.collection(this.options.mongo.collection);
  }

  processEntireCollection() {
    var db;
    var cursor;
    if (this.options.entireCollectionCursor) {
      cursor = this.options.entireCollectionCursor;
    } else {
      cursor = this.collection().find();
    }
    var count = 0;
    var startTime = new Date().getTime();

    var processor = this.processor;
    function processDocument(doc, done) {
      processor.processDoc(doc, true, (err) => {
        count++;
        done(err);
      });
    }

    var concurrency = this.options.maxBatchSize || 5000;
    mongoCursorProcessing(cursor, processDocument, concurrency, (err) => {
      if (err) {
        console.error('error processing entire collection', err);
        process.exit(1);
      }
      var elapsedSeconds = Math.round((new Date().getTime() - startTime)/1000);
      console.log('entire collection processed (' + count + ' documents, ' +
        Math.floor(elapsedSeconds / 60) + 'm' +
        elapsedSeconds % 60 + 's).');
      if (db) {
        db.close();
      }
    });
  }
}

module.exports = Listener;
