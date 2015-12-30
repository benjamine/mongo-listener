
module.exports = {
  skipFullUpsert: !/^(false|no|0)$/i.test(process.env.SKIP_FULL_UPSERT),
  http: {
    port: process.env.PORT,
  },
  mongo: {
    uri: process.env.MONGO_URL,
    uriEntireCollectionRead: process.env.MONGO_FULL_READ_URL,
    db: process.env.MONGO_DB,
    collection: process.env.MONGO_COLLECTION
  },
  redisLastOp: process.env.REDISCLOUD_URL && {
    url: process.env.REDISCLOUD_URL,
    key: process.env.REDIS_KEY || 'mongoListenerLastOp'
  }
};
