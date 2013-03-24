var
	sqlite = require(__dirname + '/../../nodam/lib/sqlite.js'),
	_      = require(__dirname + '/../../nodam/lib/curry.js'),
	nodam  = require(__dirname + '/../../nodam/lib/nodam.js');

var query = 'ALTER TABLE meals ADD name TEXT AFTER id'

sqlite.database(__dirname + '/../diet.db').pipe(function(db) {
	return db.run(query);
}).run(function() {
	console.log('Finished!');
}, function(err) {
	console.error(err);
}, {});

