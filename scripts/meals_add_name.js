var
	nodam  = require('nodam'),
	sqlite = nodam.sqlite,
	_      = nodam._;

var query = 'ALTER TABLE meals ADD name TEXT AFTER id'

sqlite.database(__dirname + '/../diet.db').pipe(function(db) {
	return db.run(query);
}).run(function() {
	console.log('Finished!');
}, function(err) {
	console.error(err);
}, {});

