var
  _      = require('../nodam/lib/curry.js'),
  orm    = require('./lib/orm2.js'),
  nodam  = require('../nodam/lib/nodam.js'),
  sql    = require('../nodam/lib/sqlite.js'),
	R      = require('../nodam/lib/restriction.js'),
  M      = nodam.Maybe,
	Async  = nodam.Async,
	util = require('util');

var __slice = [].slice;
var fmap = _.flip(_.map);

var INT = 'int';
var FLOAT = 'float';

var dbM = orm.dbM;

var queries = {
	foods:
		'SELECT * FROM foods',
	foods_insert:
		'INSERT INTO foods (name, type, cals, grams) ' +
		"VALUES ('<%= name %>', '<%= type %>', '<%= cals %>', '<%= grams %>')",
	foods_update_w_cals:
		'UPDATE foods ' +
		"SET name='<%= name %>', type='<%= type %>', cals='<%= cals %>' " +
		'WHERE id=<%= id %>',
	foods_update_w_grams:
		'UPDATE foods ' +
		"SET name='<%= name %>', type='<%= type %>', grams='<%= grams %>' " +
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

function hydrateRow(types, row, keys) {
	if (! row) throw new Error('No row given');

	if (!keys) {
		keys = _.keys(row);
	}

	var obj = {};

	_.each(keys, function(k) {
		if (row[k]) {
			if (types.k === INT) {
				obj[k] = orm.toInt(row[k]);
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
	return orm.dbGet(queries.foods + orm.condition({id: id}))
		.mmapFmap(hydrateFood);
}

function getMeal(id) {
	return orm.dbGet(queries.meals + orm.condition({id: id}))
		.mmapFmap(hydrateMeal);
}

function getMealFood(meal_id, food_id) {
	if (!meal_id || !food_id) throw new R.CheckError();

	return orm.dbGet(
		queries.meal_foods +
		orm.condition({meal_id: meal_id, food_id: food_id})
	) .mmapFmap(function(row) {
		return {
			meal_id: orm.toInt(row.meal_id),
			food_id: orm.toInt(row.food_id),
			grams:   orm.toInt(row.grams || 0)
		};
	});
}

function foodByName(name) {
	var query = queries.foods + orm.condition({name: name});
	return orm.dbGet(query);
}

function mealByName(name) {
	var query = queries.meals + orm.condition({name: name});
	return orm.dbGet(query);
}

function foodIngredients(food) {
	if (food.type !== 'dish') {
		return Async.result([]);
	} else {
		return orm.dbAll(
			queries.ingredients_with_foods + orm.condition({ 'i.food_id': food.id })
		);
	}
}

/**
 * results in the food, not the ingredients
 */
function fillIngredients(food) {
	return foodIngredients(food).pipe(function (ings) {
		return Async.result(_.set(food, 'ingredients', ings));
	});
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
				return orm.dbRunQ(
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
		return orm.dbAll(
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

var allFoods = orm.dbAll(queries.foods + ' ORDER BY name')
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
	return orm.dbRun("UPDATE plans SET name='" + name + "' WHERE id=" + plan.id)
		.then(nodam.result(_.set(plan, 'name', name)));
}

var allMeals = orm.dbAll(queries.meals + ' ORDER BY created_at DESC');

function getPlanMeals(plan) {
	return orm.dbAll(queries.plan_meals_with_meals + orm.condition({
		plan_id: plan.id
	}) + ' ORDER BY ordinal').mmap(function(rows) {
		return _.map(rows, function(row) {
			return {
				id: orm.toInt(row.id),
				plan_id: orm.toInt(row.plan_id),
				ordinal: orm.toInt(row.ordinal),
				meal: {
					id: row.meal_id,
					name: row.name
				}
			};
		});
	});
}

function getWeekPlans(week) {
	return orm.dbAll(queries.week_plans_with_plans + orm.condition({
		week_id: week.id
	}) + ' ORDER BY ordinal').mmap(function(rows) {
		return _.map(rows, function(row) {
			return {
				id: orm.toInt(row.id),
				plan_id: orm.toInt(row.plan_id),
				ordinal: orm.toInt(row.ordinal),
				plan: {
					id: row.plan_id,
					name: row.name
				}
			};
		});
	});
}


function deleteFood(id) {
  return orm.dbRun('DELETE FROM foods ' + orm.condition({ id: id }))
		.then(orm.dbRun('DELETE FROM ingredients ' + orm.condition({ food_id: id })))
		.then(orm.dbRun('DELETE FROM meal_foods ' + orm.condition({ food_id: id })));
}

function getFoodsInMeal(meal) {
	return orm.dbAll(queries.meal_foods_with_foods + orm.condition({
		meal_id: meal.id
	})).mmapFmap(hydrateMealFood);
}

function fillMealFoods(meal) {
	return getFoodsInMeal(meal)
		.pipe(function(meal_foods) {
			var meal2 = _.set(meal, 'foods', meal_foods);

			return Async.result(setMealCals(meal2));
		});
}

// ammounts = [ { food_id: { food: food, grams: number }, ...},  ...]
function addAmounts(amounts) {
	var totals = {};

	_.each(amounts, function(amount) {
		_.each(amount, function(part, food_id) {
			if (totals[food_id]) {
				totals[food_id].grams += part.grams;
			} else {
				totals[food_id] = part;
			}
		});
	});

	return totals;
}

function mealIngredients(meal) {
	return getFoodsInMeal(meal).pipe(function(m_foods) {
		return Async.mapM(m_foods, function(m_food) {
			var food = m_food.food;
			var amount = {};

			if (food.type === 'ingredient') {
				amount[food.id] = { food: food, grams: m_food.grams };

				return Async.result([amount]);
			} else {
				return foodIngredients(food).mmap(function(ingreds) {
					var total_in = _.reduce(ingreds, function(memo, ing) {
						return memo + ing.grams;
					}, 0);

					_.each(ingreds, function(ingred) {

						amount[ingred.id] = {
							food: ingred,
							grams: m_food.grams * ingred.grams / total_in
						};
					});
					return amount;
				});
			}
		}).mmap(addAmounts);
	});
}

function planIngredients(plan) {
	return getPlanMeals(plan)
		.pipeMmap(function(p_meal) {
			return mealIngredients(p_meal.meal);
		})
		.mmap(addAmounts);
}

function deleteMealFood(meal, food_id) {
	return orm.dbRun('DELETE FROM meal_foods ' + orm.condition({
		meal_id: meal.id,
		food_id: food_id
	}));
}

function updateMealName(meal, name) {
	return orm.dbRun(
		"UPDATE meals SET name='" + name + "' WHERE id=" + meal.id
	);
}

function mealById(id) {
	return orm.dbGet(queries.meals + orm.condition({ id: id }));
}

        
function deleteMeal(id) {
	return orm.dbRun('DELETE FROM meals ' + orm.condition({ id: id }))
		.then(orm.dbRun('DELETE FROM meal_foods ' + orm.condition({ meal_id: id })))
		.then(orm.dbRun('DELETE FROM plan_meals ' + orm.condition({ meal_id: id })));
}

function deletePlan(id) {
	return orm.dbRun('DELETE FROM plans ' + orm.condition({ id: id }))
		.then(orm.dbRun('DELETE FROM plan_meals ' + orm.condition({ plan_id: id })));
}

function deleteWeek(id) {
	return orm.dbRun('DELETE FROM weeks ' + orm.condition({ id: id }))
		.then(orm.dbRun('DELETE FROM week_plans ' + orm.condition({ week_id: id })));
}

function getIngredient(food_id, ing_id) {
	return orm.dbGet(queries.ingredients + orm.condition({
		food_id: food_id,
		ingredient_id: ing_id
	}));
}

function increaseIngredient(food_ing, grams) {
	return orm.runQuery(queries.ingredients_update, {
		food_id: food_ing.food_id,
		ingred_id: food_ing.ingredient_id,
		grams: orm.toInt(food_ing.grams) + grams
	});
}

function createIngredient(food, ingred, grams) {
	return orm.runQuery(queries.ingredients_insert, {
		food_id: food.id,
		ingred_id: ingred.id,
		grams: grams
	})
}

function addIngredient(food, ing_name, grams) {
  return foodByName(ing_name) .pipeMaybe(
		orm.errMissing('foods', { name: ing_name }),
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
	return orm.dbRun(
		'UPDATE plan_meals SET ordinal = ordinal + 1000' +
		orm.condition({ plan_id: plan.id })
	).then(
		nodam.Async.mapM(ords, function(old_ord, new_ord) {
			return orm.dbRun(
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

  return orm.dbRunQ(queries.set_week_plan, {
		week_id: week.id,
		plan_id: plan_id,
		ordinal: ord
	});
}

function weekIngredients(week) {
  return getWeekPlans(week)
		.pipeMmap(function(w_plan) {
			return planIngredients(w_plan.plan);
		})
		.mmap(addAmounts);
}

module.exports = {
	getDB: orm.getDB,
	dbM: dbM,
	DBMissingFailure: orm.DBMissingFailure,
	DBEmptyFailure: orm.DBEmptyFailure,

	runQuery: orm.runQuery,
	get:      orm.dbGet,
	all:      orm.dbAll,
	run:      orm.dbRun,
	reduce:   orm.dbReduce,
	getQ:     orm.dbGetQ,
	allQ:     orm.dbAllQ,
	runQ:     orm.dbRunQ,
	reduceQ:  orm.dbReduceQ,
	close:    orm.dbClose,
	getOrFail: orm.dbGetOrFail,

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
	mealIngredients:    mealIngredients,

	renamePlan:         renamePlan,
	setPlanCals:        setPlanCals,
	deletePlan:         deletePlan,
	planIngredients:    planIngredients,

	getPlanMeals:       getPlanMeals,
	reorderPlanMeals:   reorderPlanMeals,

	weekIngredients:    weekIngredients,
	deleteWeek:         deleteWeek,

	getWeekPlans:       getWeekPlans,
	setWeekPlan:        setWeekPlan,

	toInt: orm.toInt
};
