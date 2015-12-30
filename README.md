Mongo Listener
==============

- listen for changes in mongodb collections (mongo oplog)
- filter and transform docs and operations
- if restarted resumes from last op, saved on a file or a redis key
- if not last op exists, starts by processing the entire collection
