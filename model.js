var
  _      = require('../nodam/lib/curry.js'),
  orm    = require('./lib/orm.js'),
  nodam  = require('../nodam/lib/nodam.js'),
  sql    = require('../nodam/lib/sqlite.js'),
  M      = nodam.Maybe;

var fmap = _.flip(_.map);
function toInt(x) { return parseInt(x, 10) }

var dbM = nodam.get('db')
	.pipe(function(db) {
		if (db) {
			return nodam.result(db);
		} else {
			return sql.database('diet.db').pipe(function(db_open) {
				return nodam.set('db', db_open);
			});
		}
	});

// make code a little cleaner
function runQuery(tmpl, data) {
  return dbM.pipe(function(db) {
    return db.run(_.template(tmpl, data))
	})
}

function dbFunction(name) {
	return function() {
		var args = arguments
		return dbM.pipe(function(db_obj) {
			return db_obj[name].apply(db_obj, args);
		});
	};
}


var
	dbGet = dbFunction('get'),
	dbAll = dbFunction('all'),
	dbRun = dbFunction('run');

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
		'WHERE food_id=<%= food_id %> AND ingredient_id=<%= update %>',
	ingredients_with_foods:
		'SELECT i.food_id, i.ingredient_id, i.grams, ' +
		'f.id, f.name, f.type, f.cals, f.grams AS food_grams FROM ingredients i ' +
		'JOIN foods f ON i.ingredient_id=f.id',
	meals:
		'SELECT * FROM meals',
	meals_insert:
		"INSERT INTO meals (created_at) VALUES (datetime('now'))",
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
		"UPDATE foods SET cals='<%= cals %>' WHERE id=<%= id %>"
};

function setMealFoodCals(m_food) {
  var cals = m_food.grams * m_food.food.cals / 100;
  return _.set(m_food, 'cals', cals);
}

function hydrateFood(row) {
	return {
		id: toInt(row.id),
		name: row.name,
		type: row.type,
		cals: parseFloat(row.cals),
		grams: toInt(row.food_grams)
	}
}

function hydrateMeal(row) {
	return { id: toInt(row.id), created_at: row.created_at };
}

function hydrateIngredient(row) {
	return {
		id: toInt(row.id),
		name: row.name,
		type: row.type,
		cals: parseFloat(row.cals),
		food_grams: toInt(row.food_grams),
		food_id: toInt(row.food_id),
		ingredient_id: toInt(row.ingredient_id),
		grams: toInt(row.grams)
	};
}

function hydrateMealFood(row) {
  var m_food = {
		meal_id: toInt(row.meal_id),
		food_id: toInt(row.food_id),
		grams: toInt(row.grams),
		food: {
			id: toInt(row.id),
			name: row.name,
			type: row.type,
			cals: parseFloat(row.cals),
			grams: toInt(row.food_grams)
		}
	};

  return setMealFoodCals(m_food);
}

function getFood(id) {
	return dbGet(queries.foods + orm.condition({id: id})).mmap(hydrateFood);
}

function getMeal(id) {
	return dbGet(queries.meals + orm.condition({id: id})).mmap(hydrateMeal);
}

function getMealFood(meal_id, food_id) {
	return dbGet(
		queries.meal_foods +
		orm.condition({meal_id: meal_id, food_id: food_id})
	) .mmap(function(row) {
		return {
			meal_id: toInt(row.meal_id),
			food_id: toInt(row.food_id),
			grams:   toInt(row.grams)
		};
	});
}

function foodByName(name) {
	var query = queries.foods + orm.condition({name: name});
	return dbGet(query);
}

function requireString(str, err) {
	if (! str) throw new Error(err || 'empty string');
}

function requireQuery(template, data) {
	var q = _.template(template, data);
	requireString(q, 'bad query template: ' + template);

	return q;
}

/**
 * results in the food, not the ingredients
 */
function fillIngredients(food) {
	if (food.type !== 'dish' || food.ingredients) {
		return nodam.result(food);
	} else {
		return dbAll(
			queries.ingredients_with_foods + orm.condition({ 'i.food_id': food.id })
		) .pipe(function (ings) {
			return nodam.result(_.set(food, 'ingredients', ings));
		});
	}
}

// Food -> Double
function calsFromIngredients(food) {
	var ings = food.ingredients;

	return _.reduce(ings, function(memo, ing) {
		return ing.cals * ing.grams;
	}, 0) * 100 / food.grams;
}

function updateFoodCals(food) {
	if (food.type !== 'dish') {
		return nodam.result(food);
	} else {
		return fillIngredients(food)
			.mmap(calsFromIngredients)
			.pipe(function(cals) {
				return dbRun(_.template(
					queries.food_update_cals,
					{ cals: cals, id: food.id }
				)) .then(nodam.result(
					// pass the food with the new calorie count
					_.set(food, 'cals', cals)
				));
			});
	}
}

function ingredientsForFood(food) {
	if (food.type === 'ingredient') {
		return nodam.result(food);
	} else {
		return dbAll(
			queries.ingredients_with_foods +
				orm.condition({ food_id: food.id }) +
				' ORDER BY i.grams DESC'
		) .mmap(
			_.curry(fmap, hydrateIngredient)
		) .pipe(function (ingredients) {
			var $food = _.set(food, 'ingredients', ingredients);

			return nodam.result($food);
		});
	}
}

var allFoods = dbAll(queries.foods)
	.pipe(function(foods) {
		return nodam.sequence(
			_.fmap(ingredientsForFood, foods)
		)
	});

module.exports = {
  dbM:                 dbM,
  queries:             queries,
  getFood:             getFood,
  foodByName:          foodByName,
  getMeal:             getMeal,
  getMealFood:         getMealFood,
  hydrateIngredient:   hydrateIngredient,
  hydrateMealFood:     hydrateMealFood,
  fillIngredients:     fillIngredients,
  updateFoodCals:      updateFoodCals,
  ingredientsForFood:  ingredientsForFood,
  allFoods:            allFoods
};
