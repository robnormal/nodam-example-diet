var
	sqlite = require(__dirname + '/../../nodam/lib/sqlite.js'),
	_      = require(__dirname + '/../../nodam/lib/curry.js'),
	nodam  = require(__dirname + '/../../nodam/lib/nodam.js');

var queries = [
	'ALTER TABLE plan_meals RENAME TO _temp_plan_meals',
	'CREATE TABLE plan_meals (' + 
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
		'plan_id INTEGER NOT NULL, meal_id INTEGER NOT NULL)',
	'INSERT INTO plan_meals (plan_id, meal_id) ' +
		'SELECT plan_id, meal_id FROM _temp_plan_meals',
	'DROP TABLE _temp_plan_meals'
]

sqlite.database('../diet.db').pipe(function(db) {
	var ms = _.map(queries, function(q) { return db.run(q); });

	return db.serialize().then(nodam.sequence_(ms));
}).run(function() { console.log('Finished!'); }, function(err) { console.log(err); }, {});

