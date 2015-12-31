'use strict';
/*
* mocha's bdd syntax is inspired in RSpec
*   please read: http://betterspecs.org/
*/
require('./util/globals');

describe('mongoListener', function(){
  before(function(){
    this.options = {
      skipFullUpsert: true
    };
    this.listener = new mongoListener.create(this.options);
  });
  it('has a semver version', function(){
    expect(mongoListener.version).to.match(/^\d+\.\d+\.\d+(-.*)?$/);
  });

  describe('if last op cannot be determined', function(){
    it('upserts full collection in batches, and starts tailing');
  });
  describe('if last op is found', function(){
    it('just resumes since last op');
  });

  describe('on changes to fields not in the filter', function(){
    it('ignores the operation');
  });
  describe('on changes to fields in the filter', function(){
    it('reads the full doc, and upserts');
  });
  describe('on document full update', function(){
    it('upserts');
  });

  describe('processing a doc', function(){
  });

  describe('multiple consecutive upserts', function(){
    it('are sent in batches');
  });

  describe('multiple consecutive upserts', function(){
    it('are sent in batches');
  });

});
