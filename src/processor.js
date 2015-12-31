'use strict';

class Processor {

  constructor(options) {
    this.options = options || {};
    this.processQueue = [];
  }

  log() {
    if (!this.options.logger) {
      return;
    }
    this.options.logger.log.apply(this.options.logger, arguments);
  }

  setDocGetter(docGetter) {
    this.docGetter = docGetter;
  }

  processOp(op, done) {
    if (['u', 'i'].indexOf(op.op) < 0) {
      // ignore, this processor only cares about inserts or updates
      return done();
    }
    if (this.isPartialUpdate(op)) {
      var id = (op.o2 || op.o)._id;
      var filteredUpdate = this.filterOp(op);
      if (!filteredUpdate) {
        this.log('partial update, after filtering, skipping', id, op.o);
        return done();
      }
      // read full doc from db
      this.log('partial update:', op.o, ', reading full doc from db:', id);
      return this.readFullDoc(id, (err, doc) => {
        if (err) {
          return done(err);
        }
        this.processDoc(doc, false, done);
      });
    }
    return this.processDoc(op.o, false, done);
  }

  isPartialUpdate(op) {
    return op && op.op === 'u' && op.o && op.o2 &&
      Object.keys(op.o).filter(name => name[0] === '$').length > 0;
  }

  readFullDoc(id, done) {
    if (!this.docGetter) {
      return done(new Error('a docGetter is required'));
    }
    return this.docGetter(id, done);
  }

  processDoc(doc, fullUpserting, done) {
    var filtered = this.filter(doc);
    if (!filtered) {
      this.log('after filtering, no update needed');
      return;
    }
    var transformed = this.transform(filtered);
    if (!transformed) {
      this.log('after transforming, no update needed');
      return;
    }
    if (!fullUpserting) {
      this.log('upserting', transformed._id);
    }
    return this.upsert(transformed, done);
  }

  filterField(field) {
    var fieldPath = field.split(/\.[\$\d]*\.?/g);
    var filterNode = this.options.filter;
    while (fieldPath.length) {
      var member = fieldPath.shift();
      if (!filterNode[member]) {
        return false;
      }
      filterNode = filterNode[member];
      if (typeof filterNode !== 'object') {
        return true;
      }
    }
    return true;
  }

  filterOp(op) {
    if (!op.o || !this.options.filter || typeof this.options.filter !== 'object') {
      return op;
    }
    for (var name in op.o) {
      if (name[0] !== '$') {
        // not partial update, always pass
        return op;
      }
      if (name === '$set' || name === '$unset') {
        for (var field in op.o[name]) {
          if (this.filterField(field)) {
            // this field passes the filter, update is needed
            return op;
          }
        }
      } else {
        // another type of operator, to be safe, assume update is needed
        return op;
      }
    }
    // based on filter, this op can be ignored
    return false;
  }

  filter(doc) {
    if (!doc || !this.options.filter || typeof this.options.filter !== 'object') {
      return doc;
    }

    function filterNode(node, nodeFilter) {
      if (Array.isArray(node)) {
        return node.forEach(item => filterNode(item, nodeFilter));
      }
      for (var name in node) {
        if (!nodeFilter[name]) {
          delete node[name];
        } else {
          if (typeof node[name] === 'object' &&
            typeof nodeFilter[name] === 'object') {
            filterNode(node[name], nodeFilter[name]);
            if (Object.keys(node[name]).length < 1) {
              delete node[name];
            }
          }
        }
      }
    }

    filterNode(doc, this.options.filter);
    if (Object.keys(doc).length < 1) {
      return;
    }
    return doc;
  }

  transform(doc) {
    if (!doc || !this.options.transform || typeof this.options.transform !== 'function') {
      return doc;
    }
    var id = doc._id;
    try {
      return this.options.transform(doc);
    } catch(err) {
      this.log(new Error('transform error: ' + err.toString()));
      return {
        _id: id,
        processingFailed: true,
        processingError: err.toString(),
        tags: ['processing-failed']
      };
    }
  }

  upsert(doc, done) {
    if (doc._id) {
      doc.objectID = doc._id;
      delete doc._id;
    }
    this.processQueue.push({
      doc: doc,
      done: done
    });
    this.scheduleNextQueuedDocsProcess();
  }

  scheduleNextQueuedDocsProcess() {
    if (!this.processQueue.length || this.processTimeout) {
      return;
    }
    this.processTimeout = setTimeout(() => {
      delete this.processTimeout;
      this.processQueuedDocs();
    }, this.options.batchProcessDelay || 5000);
  }

  processQueuedDocs() {
    if (this.processQueue.length < 1) {
      return;
    }

    var batch = this.processQueue.splice(0, this.options.maxBatchSize || 5000);
    var docs = batch.map(batchItem => batchItem.doc);

    try {
      this.processDocs(docs, (err, content) => {
        if (err) {
          this.log(err);
        }
        batch.forEach((batchItem) => {
          if (batchItem.done) {
            batchItem.done(err, content);
          }
        });
      });
    } catch(err) {
      this.log(err);
    }

    this.scheduleNextQueuedDocsProcess();
  }

  processDocs(docs, done) {
    if (!this.options.processDocs) {
      setTimeout(done, 10);
      return;
    }
    this.options.processDocs(docs, done);
  }

}

module.exports = Processor;
