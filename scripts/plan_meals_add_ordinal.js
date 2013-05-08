var
	nodam  = require('nodam'),
	sqlite = nodam.sqlite,
	_      = nodam._;

var queries = [
	'DROP TABLE IF EXISTS _temp_plan_meals',
	'ALTER TABLE plan_meals RENAME TO _temp_plan_meals',
	'CREATE TABLE plan_meals (' + 
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
		'plan_id INTEGER NOT NULL, ' +
 		'meal_id INTEGER NOT NULL, ' +
		'ordinal INTEGER NOT NULL)',
	'INSERT INTO plan_meals (id, plan_id, meal_id, ordinal) ' +
		'SELECT id, plan_id, meal_id, 0 FROM _temp_plan_meals',
	'DROP TABLE _temp_plan_meals',
	'CREATE UNIQUE INDEX meal_ordinal ON plan_meals (plan_id, ordinal)'
]

sqlite.database('../diet.db').pipe(function(db) {
	var ms = _.map(queries, function(q) { return db.run(q); });

	return db.serialize().then(nodam.Async.sequence_(ms));
}).run(function() { console.log('Finished!'); }, function(err) { console.log(err); }, {});


