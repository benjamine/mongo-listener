'use strict';
// global exports

var Listener = require('./listener');
exports.Listener = Listener;
exports.create = function(options) {
  return new Listener(options);
};

var packageInfo = require('../pack'+'age.json');
exports.version = packageInfo.version;
exports.homepage = packageInfo.homepage;
