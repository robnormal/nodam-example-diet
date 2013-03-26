var queries = [
	'CREATE TABLE IF NOT EXISTS foods (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, ' +
		'type TEXT NOT NULL, cals REAL NOT NULL, grams INT)',
	'CREATE TABLE IF NOT EXISTS ingredients (' +
		'food_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL, grams INTEGER, ' +
		'PRIMARY KEY (food_id, ingredient_id))',
	'CREATE TABLE IF NOT EXISTS meals (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, ' +
		'created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
	'CREATE TABLE IF NOT EXISTS meal_foods (' +
		'meal_id INTEGER NOT NULL, food_id INTEGER NOT NULL, grams INTEGER, ' +
		'PRIMARY KEY (meal_id, food_id))',
	'CREATE TABLE IF NOT EXISTS plans (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)',
	'CREATE TABLE IF NOT EXISTS plan_meals (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
		'plan_id INTEGER NOT NULL, meal_id INTEGER NOT NULL, ordinal INTEGER NOT NULL)',
	'CREATE UNIQUE INDEX IF NOT EXISTS meal_ordinal ON plan_meals (plan_id, ordinal)',
	'CREATE TABLE IF NOT EXISTS weeks (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)',
	'CREATE TABLE IF NOT EXISTS week_plans (' +
		'id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, ' +
		'week_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, ordinal INTEGER NOT NULL)',
	'CREATE UNIQUE INDEX IF NOT EXISTS plan_ordinal ON week_plans (week_id, ordinal)'
];

var
	sqlite = require('../../nodam/lib/sqlite.js'),
	_      = require('../../nodam/lib/curry.js'),
	nodam  = require('../../nodam/lib/nodam.js');
	db  = require('../model.js');

db.getDB(__dirname + '/../diet.db').pipe(function() {
	var ms = _.map(queries, function(q) {
		return db.run(q);
	});

	return nodam.Async.sequence_(ms);
}).run(function() { console.log('Finished!'); }, function(err) { console.log(err); }, {});

