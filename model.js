var
  _      = require('../nodam/lib/curry.js'),
  orm    = require('./lib/orm.js'),
  nodam  = require('../nodam/lib/nodam.js'),
  sql    = require('../nodam/lib/sqlite.js'),
	R      = require('../nodam/lib/restriction.js'),
  M      = nodam.Maybe,
	Async  = nodam.Async,
	util = require('util');

var __slice = [].slice;
var fmap = _.flip(_.map);

function toInt(x) { return parseInt(x, 10) }

function DBEmptyFailure(query, params) {
  this.err = { query: query, params: params };
}
util.inherits(DBEmptyFailure, nodam.AsyncFailure);

function DBMissingFailure(table, condition) {
  this.err = { table: table, condition: condition };
}
util.inherits(DBMissingFailure, DBEmptyFailure);

function errMissing(table, condition) {
	return new DBMissingFailure(table, condition);
}

function getDB(file) {
	return nodam.get('db')
		.pipe(function(db) {
			if (db) {
				return Async.result(db);
			} else {
				return sql.database(file).pipe(function(db_open) {
					return nodam.set('db', db_open);
				});
			}
		});
}


// The master database monad object
var dbM = getDB('diet.db');


// utilities
function requireString(str, err) {
	if (! str) throw new Error(err || 'empty string');
}

function requireQuery(tmpl, data) {
	R.manualCheck(tmpl && (typeof tmpl === 'string'), 'Expected string template');

	var q = _.template(tmpl, data);
	requireString(q, 'bad query template: ' + tmpl);

	return q;
}


// make code a little cleaner
function dbFunction(name) {
	return function() {
		var args = arguments;
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, args);
		});
	};
}

function dbQueryFunction(name) {
	return function(query /* , args... */) {
		R.manualCheck(query && (typeof query === 'string'), 'Expected SQL query');

		var args = __slice.call(arguments, 1);
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, [query].concat(args));
		});
	};
}

function dbTemplateFunction(name) {
	return function(tmpl, data /*, args.. */) {
		var q = requireQuery(tmpl, data);

		var args = __slice.call(arguments, 2);
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, [q].concat(args));
		});
	};
}

var runQuery = dbTemplateFunction('run');

var
	dbGet = dbQueryFunction('get'),
	dbAll = dbQueryFunction('all'),
	dbRun = dbQueryFunction('run'),
	dbReduce = dbQueryFunction('reduce'),

	dbGetQ = dbTemplateFunction('get'),
	dbAllQ = dbTemplateFunction('all'),
	dbRunQ = dbTemplateFunction('run'),
	dbReduceQ = dbTemplateFunction('reduce'),

	dbClose = dbFunction('close'),
	dbGetOrFail = function(q, params) {
		return dbGet(q, params).pipeMaybe(
			new DBEmptyFailure(q, params),
			Async.result
		);
	};

var queries = {
	foods:
		'SELECT * FROM foods',
	foods_insert:
		'INSERT INTO foods (name, type, cals, grams) ' +
		"VALUES ('<%= name %>', '<%= type %>', '<%= cals %>', '<%= grams %>')",
	foods_update:
		'UPDATE foods ' +
		"SET name='<%= name %>', type='<%= type %>', cals='<%= cals %>', grams='<%= grams %>' " +
		'WHERE id=<%= id %>',
	ingredients:
		'SELECT * from ingredients',
	ingredients_insert:
		'INSERT INTO ingredients (food_id, ingredient_id, grams) VALUES ' +
		'(<%= food_id %>, <%= ingred_id %>, <%= grams %>)',
	ingredients_update:
		'UPDATE ingredients SET grams=<%= grams %> ' +
		'WHERE food_id=<%= food_id %> AND ingredient_id=<%= ingred_id %>',
	ingredients_with_foods:
		'SELECT i.food_id, i.ingredient_id, i.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM ingredients i ' +
		'JOIN foods f ON i.ingredient_id=f.id',
	meals:
		'SELECT * FROM meals',
	meals_insert:
		"INSERT INTO meals (name, created_at) VALUES ('<%= name %>', datetime('now'))",
	meal_foods:
		'SELECT * from meal_foods',
	meal_foods_with_foods:
		'SELECT mf.meal_id, mf.food_id, mf.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM meal_foods mf ' +
		'JOIN foods f ON mf.food_id=f.id',
	meal_foods_update:
		'UPDATE meal_foods SET grams=<%= grams %> ' +
		'WHERE meal_id=<%= meal_id %> AND food_id=<%= food_id %>',
	meal_foods_insert:
		'INSERT INTO meal_foods (meal_id, food_id, grams) ' +
		'VALUES (<%= meal_id %>, <%= food_id %>, <%= grams %>)',
	food_update_cals:
		"UPDATE foods SET cals='<%= cals %>' WHERE id=<%= id %>",
	food_list:
    "SELECT name FROM foods WHERE name LIKE '<%= term %>%'",
	plans:
		'SELECT * from plans',
	plans_insert:
		"INSERT INTO plans (name) VALUES ('<%= name %>')",
	plan_meals:
		'SELECT * FROM plan_meals',
	plan_meals_with_meals:
		'SELECT pm.id, pm.plan_id, pm.meal_id, pm.ordinal, m.name FROM plan_meals pm ' +
		'JOIN meals m ON m.id=pm.meal_id',
	plan_meals_insert:
		'INSERT INTO plan_meals (plan_id, meal_id, ordinal) ' +
			'VALUES (<%= plan_id %>, <%= meal_id %>, <%= ordinal %>)',
	weeks:
		'SELECT * from weeks',
	weeks_insert:
		"INSERT INTO weeks (name) VALUES ('<%= name %>')",
	week_plans:
		'SELECT * FROM week_plans',
	week_plans_with_plans:
		'SELECT wp.id, wp.week_id, wp.plan_id, wp.ordinal, p.name FROM week_plans wp ' +
		'JOIN plans p ON p.id=wp.plan_id',
	set_week_plan:
		'INSERT OR REPLACE INTO week_plans (week_id, plan_id, ordinal) ' +
		'VALUES (<%= week_id %>, <%= plan_id %>, <%= ordinal %>)'
};

function setMealFoodCals(m_food) {
  var cals = m_food.grams * m_food.food.cals / 100;
  return _.set(m_food, 'cals', cals);
}

var INT = 'int';
var FLOAT = 'float';

function hydrateRow(types, row, keys) {
	if (! row) throw new Error('No row given');

	if (!keys) {
		keys = _.keys(row);
	}

	var obj = {};

	_.each(keys, function(k) {
		if (row[k]) {
			if (types.k === INT) {
				obj[k] = toInt(row[k]);
			} else if (types.k === FLOAT) {
				obj[k] = parseFloat(row[k]);
			} else {
				obj[k] = row[k];
			}
		}
	});

	return obj;
}

var columnTypes = {
	id: INT,
	grams: INT,
	food_id: INT,
	meal_id: INT,
	plan_id: INT,
	ingredient_id: INT,
	cals: FLOAT
};

function hydrateCommonAll(row) {
	return hydrateRow(columnTypes, row, null);
}

function hydrateCommon(row, keys) {
	return hydrateRow(columnTypes, row, keys);
}

var hydrateFood = hydrateCommon;
var hydrateMeal = hydrateCommon;

function hydrateIngredient(row) {
	return hydrateRow(_.extend({
		food_grams: INT
	}, columnTypes), row);
}

function hydrateMealFood(row) {
	var food = hydrateCommon(row, ['id', 'name', 'type', 'cals', 'grams']);
	var m_food = hydrateCommon(row, ['meal_id', 'food_id', 'grams']);
	m_food.food = food;

  return setMealFoodCals(m_food);
}

function getFood(id) {
	return dbGet(queries.foods + orm.condition({id: id})).mmap(hydrateFood);
}

function getMeal(id) {
	return dbGet(queries.meals + orm.condition({id: id})).mmap(hydrateMeal);
}

function getMealFood(meal_id, food_id) {
	if (!meal_id || !food_id) throw new R.CheckError();

	return dbGet(
		queries.meal_foods +
		orm.condition({meal_id: meal_id, food_id: food_id})
	) .mmapFmap(function(row) {
		return {
			meal_id: toInt(row.meal_id),
			food_id: toInt(row.food_id),
			grams:   toInt(row.grams || 0)
		};
	});
}

function foodByName(name) {
	var query = queries.foods + orm.condition({name: name});
	return dbGet(query);
}

function mealByName(name) {
	var query = queries.meals + orm.condition({name: name});
	return dbGet(query);
}

/**
 * results in the food, not the ingredients
 */
function fillIngredients(food) {
	if (food.type !== 'dish' || food.ingredients) {
		return Async.result(food);
	} else {
		return dbAll(
			queries.ingredients_with_foods + orm.condition({ 'i.food_id': food.id })
		) .pipe(function (ings) {
			return Async.result(_.set(food, 'ingredients', ings));
		});
	}
}

// Food -> Double
function calsFromIngredients(food) {
	var ings = food.ingredients;

	var total_cals = _.reduce(ings, function(memo, ing) {
		return memo + ing.cals * ing.grams;
	}, 0) / 100;

	return total_cals / food.grams * 100;
}

function updateFoodCals(food) {
	if (food.type !== 'dish') {
		return Async.result(food);
	} else {
		return fillIngredients(food)
			.mmap(calsFromIngredients)
			.pipe(function(cals) {
				return dbRunQ(
					queries.food_update_cals,
					{ cals: cals, id: food.id }
				) .then(Async.result(
					// pass the food with the new calorie count
					_.set(food, 'cals', cals)
				));
			});
	}
}

function ingredientsForFood(food) {
	if (food.type === 'ingredient') {
		return Async.result(food);
	} else {
		return dbAll(
			queries.ingredients_with_foods +
				orm.condition({ food_id: food.id }) +
				' ORDER BY i.grams DESC'
		) .mmap(
			_.curry(fmap, hydrateIngredient)
		) .pipe(function (ingredients) {
			var $food = _.set(food, 'ingredients', ingredients);

			return Async.result($food);
		});
	}
}

var allFoods = dbAll(queries.foods + ' ORDER BY name')
	.pipe(function(foods) {
		return Async.sequence(
			_.fmap(ingredientsForFood, foods)
		)
	});

function setMealCals(meal) {
	var cals = _.reduce(meal.foods, function(memo, m_food) {
		return memo + m_food.cals;
	}, 0);
	return _.set(meal, 'cals', cals);
}

function setPlanCals(plan) {
	var cals = _.reduce(plan.p_meals, function(memo, p_meal) {
		return memo + p_meal.meal.cals;
	}, 0);
	return _.set(plan, 'cals', cals);
}

function renamePlan(plan, name) {
	return dbRun("UPDATE plans SET name='" + name + "' WHERE id=" + plan.id)
		.then(nodam.result(_.set(plan, 'name', name)));
}

var allMeals = dbAll(queries.meals + ' ORDER BY created_at DESC');

function getPlanMeals(plan) {
	return dbAll(queries.plan_meals_with_meals + orm.condition({
		plan_id: plan.id
	}) + ' ORDER BY ordinal').mmap(function(rows) {
		return _.map(rows, function(row) {
			return {
				id: toInt(row.id),
				plan_id: toInt(row.plan_id),
				ordinal: toInt(row.ordinal),
				meal: {
					id: row.meal_id,
					name: row.name
				}
			};
		});
	});
}

function getWeekPlans(week) {
	return dbAll(queries.week_plans_with_plans + orm.condition({
		week_id: week.id
	}) + ' ORDER BY ordinal').mmap(function(rows) {
		return _.map(rows, function(row) {
			return {
				id: toInt(row.id),
				plan_id: toInt(row.plan_id),
				ordinal: toInt(row.ordinal),
				plan: {
					id: row.plan_id,
					name: row.name
				}
			};
		});
	});
}


function deleteFood(id) {
  return dbRun('DELETE FROM foods ' + orm.condition({ id: id }))
		.then(dbRun('DELETE FROM ingredients ' + orm.condition({ food_id: id })))
		.then(dbRun('DELETE FROM meal_foods ' + orm.condition({ food_id: id })));
}

function fillMealFoods(meal) {
	return dbAll(queries.meal_foods_with_foods + orm.condition({
		meal_id: meal.id
	})).mmap(function(rows) {
		return _.fmap(hydrateMealFood, rows);
	}).pipe(function(meal_foods) {
		var meal2 = _.set(meal, 'foods', meal_foods);
		return Async.result(setMealCals(meal2));
	});
}

function deleteMealFood(meal, food_id) {
	return dbRun('DELETE FROM meal_foods ' + orm.condition({
		meal_id: meal.id,
		food_id: food_id
	}));
}

function updateMealName(meal, name) {
	return dbRun(
		"UPDATE meals SET name='" + name + "' WHERE id=" + meal.id
	);
}

function mealById(id) {
	return dbGet(queries.meals + orm.condition({ id: id }));
}

        
function deleteMeal(id) {
	return dbRun('DELETE FROM meals ' + orm.condition({ id: id }))
		.then(dbRun('DELETE FROM meal_foods ' + orm.condition({ meal_id: id })))
		.then(dbRun('DELETE FROM plan_meals ' + orm.condition({ meal_id: id })));
}

function deletePlan(id) {
	return dbRun('DELETE FROM plans ' + orm.condition({ id: id }))
		.then(dbRun('DELETE FROM plan_meals ' + orm.condition({ plan_id: id })));
}

function deleteWeek(id) {
	return dbRun('DELETE FROM weeks ' + orm.condition({ id: id }))
		.then(dbRun('DELETE FROM week_plans ' + orm.condition({ week_id: id })));
}

function getIngredient(food_id, ing_id) {
	return dbGet(queries.ingredients + orm.condition({
		food_id: food_id,
		ingredient_id: ing_id
	}));
}

function increaseIngredient(food_ing, grams) {
	return runQuery(queries.ingredients_update, {
		food_id: food_ing.food_id,
		ingred_id: food_ing.ingredient_id,
		grams: toInt(food_ing.grams) + grams
	});
}

function createIngredient(food, ingred, grams) {
	return runQuery(queries.ingredients_insert, {
		food_id: food.id,
		ingred_id: ingred.id,
		grams: grams
	})
}

function addIngredient(food, ing_name, grams) {
  return foodByName(ing_name) .pipeMaybe(
		errMissing('foods', { name: ing_name }),
		function (ingred) {
			return getIngredient(food.id, ingred.id) .pipeMaybe(
				createIngredient(food, ingred, grams),
				function (food_ing) {
					return increaseIngredient(food_ing, grams);
				}
			).then(updateFoodCals(food));
		}
	);
}
                  
function reorderPlanMeals(plan, ords) {
	return dbRun(
		'UPDATE plan_meals SET ordinal = ordinal + 1000' +
		orm.condition({ plan_id: plan.id })
	).then(
		nodam.Async.mapM(ords, function(old_ord, new_ord) {
			console.log(
				'UPDATE plan_meals SET ordinal = ' + (new_ord + 1) +
				orm.condition({ plan_id: plan.id, ordinal: old_ord + 1000 })
			);
			return dbRun(
				'UPDATE plan_meals SET ordinal = ' + (new_ord + 1) +
				orm.condition({ plan_id: plan.id, ordinal: old_ord + 1000 })
			);
		})
	);
}

function setWeekPlan(week, ord, plan_id) {
	if (! week.id || typeof week.id !== 'number') {
		return nodam.failure('Invalid week: ' + week);
	} else if (! plan_id || typeof plan_id !== 'number') {
		return nodam.failure('Invalid plan: ' + plan_id);
	} else if (! ord || typeof ord !== 'number') {
		return nodam.failure('Invalid ordinal: ' + ord);
	}

  return dbRunQ(queries.set_week_plan, {
		week_id: week.id,
		plan_id: plan_id,
		ordinal: ord
	});
}

module.exports = {
	getDB: getDB,
	dbM: dbM,
	DBMissingFailure: DBMissingFailure,
	DBEmptyFailure: DBEmptyFailure,
	
	runQuery: runQuery,
	get:      dbGet,
	all:      dbAll,
	run:      dbRun,
	reduce:   dbReduce,
	getQ:     dbGetQ,
	allQ:     dbAllQ,
	runQ:     dbRunQ,
	reduceQ:  dbReduceQ,
	close:    dbClose,
	getOrFail: dbGetOrFail,
	
	hydrateRow:          hydrateRow,
	hydrateCommon:       hydrateCommon,
	hydrateCommonAll:    hydrateCommonAll,
	hydrateIngredient:   hydrateIngredient,
	hydrateMealFood:     hydrateMealFood,
	
	queries:             queries,
	
	allFoods:           allFoods,
	getFood:            getFood,
	foodByName:         foodByName,
	deleteFood:         deleteFood,
	
	ingredientsForFood: ingredientsForFood,
	fillIngredients:    fillIngredients,
	addIngredient:   addIngredient,
	updateFoodCals:     updateFoodCals,
	
	mealByName:         mealByName,
	mealById:           mealById,
	getMeal:            getMeal,
	allMeals:           allMeals,
	updateMealName:     updateMealName,
	setMealCals:        setMealCals,
	
	getMealFood:        getMealFood,
	fillMealFoods:      fillMealFoods,
	deleteMealFood:     deleteMealFood,
	
	renamePlan:         renamePlan,
	setPlanCals:        setPlanCals,
	deletePlan:         deletePlan,
	
	getPlanMeals:       getPlanMeals,
	reorderPlanMeals:   reorderPlanMeals,
	getWeekPlans:       getWeekPlans,
	setWeekPlan:        setWeekPlan,
	
	deleteWeek:         deleteWeek,
	toInt: toInt
};
