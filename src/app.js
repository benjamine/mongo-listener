'use strict';

var growl = require('growl');
var packageInfo = require('../package');
var Listener = require('./listener');
var appVersion = exports.appVersion = /(^\d+.\d+)/.exec(packageInfo.version)[1];

class AppContainer {

  start(options) {
    var app = this.app = new Listener(options);
    app.appVersion = appVersion;
    this.startListener();
    return app;
  }

  startListener() {
    this.app.start();
    if (this.app.options.growl) {
      var packageInfo = require('../package');
      growl(packageInfo.name + ' started');
    }
  }
}

module.exports = AppContainer;
