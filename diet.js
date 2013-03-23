// Generated by CoffeeScript 1.6.1
(function() {
  var DELETE, GET, M, POST, PUT, R, actions, addIngredient, addMealToPlan, apology, createFood, createMealFood, createPlan, db, dbM, deleteIngredient, fmap, foodUrl, fs, getLatestMeal, jade, logError, mealUrl, nodam, orm, planUrl, qs, queries, removeMealFromPlan, routes, sql, toInt, updateFood, updateIngredient, updateMealFood, web, _;

  Error.stackTraceLimit = Infinity;

  process.on('error', function(err) {
    return console.log(err.stack);
  });

  _ = require('../nodam/lib/curry.js');

  nodam = require('../nodam/lib/nodam.js');

  sql = require('../nodam/lib/sqlite.js');

  R = require('../nodam/lib/restriction.js');

  orm = require('./lib/orm.js');

  db = require('./model.js');

  web = require('./web.coffee');

  qs = require('querystring');

  jade = require('jade');

  fs = nodam.fs();

  M = nodam.Maybe;

  nodam.debug(true);

  GET = 'GET';

  POST = 'POST';

  PUT = 'PUT';

  DELETE = 'DELETE';

  dbM = db.dbM;

  queries = db.queries;

  fmap = _.flip(_.map);

  toInt = db.toInt;

  foodUrl = function(food) {
    return '/food/' + web.wordToUri(food.name);
  };

  mealUrl = function(meal) {
    return '/meal/' + meal.id;
  };

  planUrl = function(plan) {
    return '/plan/' + web.wordToUri(plan.name);
  };

  web.helper.foodUrl = foodUrl;

  web.helper.mealUrl = mealUrl;

  web.helper.planUrl = planUrl;

  apology = 'Sorry, there was a problem with your request.';

  logError = function(err) {
    console.log(err);
    console.log(err.stack);
    return nodam.result();
  };

  createFood = function(post) {
    return db.runQuery(queries.foods_insert, {
      name: post.food_name,
      type: post.food_type,
      cals: post.food_cals || '',
      grams: post.food_grams || ''
    });
  };

  updateFood = function(post) {
    return db.runQuery(queries.foods_update, {
      name: post.food_name,
      type: post.food_type,
      cals: post.food_cals || '',
      grams: post.food_grams || '',
      id: post.update
    });
  };

  deleteIngredient = function(post, food) {
    return db.run('DELETE FROM ingredients ' + orm.condition({
      food_id: food.id,
      ingredient_id: post['delete']
    }));
  };

  addIngredient = function(post, food) {
    return db.addIngredient(food, post.ing_name, toInt(post.grams) || 0).rescue(web.error403('No ingredient called "' + post.ing_name + '" was found.'));
  };

  updateIngredient = function(post, food) {
    return db.runQuery(queries.ingredients_update, {
      food_id: post.food_id,
      grams: post.grams,
      ingred_id: post.update
    }).then(db.updateFoodCals(food));
  };

  createMealFood = function(meal, post) {
    var post_grams;
    if (!meal.id) {
      return nodam.failure('No meal with that ID exists.');
    } else {
      post_grams = toInt(post.grams || 0);
      return db.foodByName(post.food_name).pipeMaybe(nodam.failure('No food with that name exists.'), function(food) {
        console.log(food);
        console.log(_.template(queries.meal_foods_insert, {
          meal_id: meal.id,
          food_id: food.id,
          grams: post_grams
        }));
        return db.getMealFood(meal.id, food.id).pipeMaybe(db.runQuery(queries.meal_foods_insert, {
          meal_id: meal.id,
          food_id: food.id,
          grams: post_grams
        }), function(meal_food) {
          return db.runQuery(queries.meal_foods_update, {
            meal_id: meal.id,
            food_id: food.id,
            grams: meal_food.grams + post_grams
          });
        });
      });
    }
  };

  updateMealFood = function(meal, post) {
    return db.runQuery(queries.meal_foods_update, {
      meal_id: meal.id,
      food_id: post.update,
      grams: post.grams
    });
  };

  createPlan = function(post) {
    if (post.name) {
      return db.runQuery(queries.plans_insert, {
        name: post.name
      }).then(db.getOrFail(queries.plans + orm.condition({
        id: orm.literal('last_insert_rowid()')
      })));
    } else {
      return nodam.failure('Invalid form submission.');
    }
  };

  addMealToPlan = function(post, plan) {
    if (!post.meal_name) {
      return nodam.failure('Invalid form submission.');
    }
    return db.mealByName(post.meal_name).pipePipe(function(meal) {
      return db.runQuery(queries.plan_meals_insert, {
        plan_id: plan.id,
        meal_id: m_meal.id
      });
    }).or(nodam.failure('No meal exists by that name'));
  };

  removeMealFromPlan = function(post, plan) {
    if (post.removeMeal) {
      return db.run('DELETE FROM plan_meals' + orm.condition({
        id: post.removeMeal
      }));
    } else {
      return nodam.failure('Invalid form submission.');
    }
  };

  getLatestMeal = db.get(queries.meals + orm.condition({
    id: orm.literal('last_insert_rowid()')
  }));

  actions = {
    root: function(match) {
      return db.allFoods.pipe(function(rows) {
        return web.showView('foods', {
          foods: rows
        });
      });
    },
    food: function(match) {
      var changes;
      changes = web.getPost.pipe(function(post) {
        if (post['delete']) {
          return db.deleteFood(post['delete']);
        } else if (post.create) {
          return createFood(post);
        } else if (post.update) {
          return updateFood(post);
        } else {
          return nodam.result();
        }
      });
      return changes.then(web.redirect('/'));
    },
    ingredients: function(match) {
      var food_name;
      food_name = match[1] && web.uriToWord(match[1]);
      if (!food_name) {
        return web.error404;
      }
      return db.foodByName(food_name).pipeMaybe(web.error404, function(food) {
        if (food.type === 'dish') {
          return db.ingredientsForFood(food).pipe(function(food2) {
            return web.showView('ingredients', {
              ingredients: food2.ingredients,
              food: food2,
              food_url: foodUrl(food2)
            });
          });
        } else {
          return nodam.result(food.name + ' has no ingredients.');
        }
      });
    },
    manageIngredients: function(match) {
      var food_name;
      food_name = match[1] && web.uriToWord(match[1]);
      if (!food_name) {
        return web.error404;
      }
      return web.getPost.pipe(function(post) {
        return db.foodByName(food_name).pipeMaybe(web.error403('No such food: ' + food_name), function(food) {
          var changes;
          changes = 'dish' !== food.type ? web.error403(food_name + ' cannot have ingredients.') : post['delete'] ? deleteIngredient(post, food) : post.create ? addIngredient(post, food) : post.update ? updateIngredient(post, food) : web.error403('Invalid form submission.');
          return changes.then(web.redirect(match[0]));
        });
      });
    },
    meals: function(match) {
      return db.allMeals.pipe(function(meals) {
        return web.showView('meals', {
          meals: meals
        });
      });
    },
    manageMeals: function(match) {
      return nodam.combineStrict([dbM, web.getPost]).pipeArray(function(db_obj, post) {
        if (post['delete']) {
          return db.run('DELETE FROM meals ' + orm.condition({
            id: post['delete']
          })).then(web.redirect('/meals'));
        } else if (post.create) {
          return db.runQuery(queries.meals_insert, {
            name: post.name
          }).then(getLatestMeal).pipeMaybe(web.error403(apology, function(meal) {
            return web.redirect(mealUrl(meal));
          }));
        } else {
          return web.redirect('/meals');
        }
      });
    },
    meal: function(match) {
      if (!match[1]) {
        return web.error404;
      }
      return db.mealById(match[1]).pipeMaybe(web.error404, function(meal) {
        return db.fillMealFoods(meal).pipe(function(mealFilled) {
          return web.showView('meal', {
            meal_foods: mealFilled.foods,
            meal: mealFilled
          });
        });
      });
    },
    mealFoods: function(match) {
      var meal_id;
      meal_id = match[1];
      if (!meal_id) {
        return web.error404;
      }
      return nodam.combineStrict([dbM, web.getPost]).pipeArray(function(db_obj, post) {
        var changes;
        changes = db.mealById(meal_id).pipeMaybe(nodam.failure('No meal with that id: ' + meal_id), function(meal) {
          if (post.meal_name) {
            return db.updateMealName(meal, post.meal_name);
          } else if (post['delete']) {
            return db.deleteMealFood(meal, post['delete']);
          } else if (post.create) {
            return createMealFood(meal, post);
          } else if (post.update) {
            return updateMealFood(meal, post);
          } else {
            return nodam.failure('Invalid form submission.');
          }
        });
        return changes.then(web.redirect(match[0])).rescue(function(err) {
          return logError(err).then(web.error403(apology));
        });
      });
    },
    foodList: function(match) {
      var m, term;
      term = match[2];
      m = term ? db.allQ(db.queries.food_list, {
        term: term
      }).mmap(function(rows) {
        var names;
        if (rows) {
          names = _.map(rows, function(row) {
            return row.name;
          });
          return JSON.stringify(names);
        } else {
          return nodam.result('');
        }
      }) : nodam.result('');
      return m.pipe(web.success);
    },
    plans: function(match) {
      return db.all(queries.plans).pipe(function(plans) {
        return web.showView('plans', {
          plans: plans
        });
      });
    },
    planMeals: function(match) {
      var plan_name;
      plan_name = match[1] && web.uriToWord(match[1]);
      return db.get(queries.plans + orm.condition({
        name: plan_name
      })).pipeMaybe(web.error403('No plan "' + plan_name + '" exists.'), function(plan) {
        return db.getPlanMeals(plan).pipe(function(p_meals) {
          return nodam.mapM(p_meals, function(p_meal) {
            return db.fillMealFoods(p_meal.meal).mmap(function(meal) {
              return _.set(p_meal, 'meal', meal);
            });
          });
        }).pipe(function(planMealsFilled) {
          var planFilled;
          planFilled = _.set(plan, 'p_meals', planMealsFilled);
          return db.allMeals.pipe(function(all_meals) {
            return web.showView('plan', {
              plan: db.setPlanCals(planFilled),
              all_meals: all_meals
            });
          });
        });
      });
    },
    createPlan: function(match) {
      return nodam.combineStrict([dbM, web.getPost]).pipeArray(function(db_obj, post) {
        var newPlan;
        newPlan = post.create ? createPlan(post) : nodam.failure('Invalid form submission.');
        return newPlan.pipe(function(plan) {
          return web.redirect(planUrl(plan));
        }).rescue(web.error403);
      });
    },
    managePlan: function(match) {
      return nodam.combineStrict([dbM, web.getPost]).pipeArray(function(db_obj, post) {
        var m, plan_name;
        m = post.create ? createPlan(post) : (plan_name = match[1] && web.uriToWord(match[1]), db.get(queries.plans + orm.condition({
          name: plan_name
        })).pipeMaybe(nodam.failure('No plan with that id: ' + plan_id), function(plan) {
          if (post['delete']) {
            return deletePlan(plan);
          } else if (post.update) {
            return updatePlan(post, plan);
          } else if (post.addMeal) {
            return addMealToPlan(post, plan);
          } else if (post.removeMeal) {
            return removeMealFromPlan(post, plan);
          } else {
            return nodam.failure('Invalid form submission.');
          }
        }));
        return m.then(web.redirect(match[0])).rescue(web.error403);
      });
    }
  };

  routes = [
    [
      '/', {
        GET: actions.root
      }
    ], [
      /^\/food\/([\w\+-]+)/, {
        GET: actions.ingredients,
        POST: actions.manageIngredients
      }
    ], [
      /^\/food(\/?)$/, {
        POST: actions.food
      }
    ], [
      /^\/meals(\/?)$/, {
        GET: actions.meals
      }
    ], [
      /^\/meal\/(\d+)/, {
        GET: actions.meal,
        POST: actions.mealFoods
      }
    ], [
      /^\/meal(\/?)$/, {
        POST: actions.manageMeals
      }
    ], [
      /^\/plans(\/?)$/, {
        GET: actions.plans
      }
    ], [
      /^\/plan(\/?)$/, {
        POST: actions.managePlan
      }
    ], [
      /^\/plan\/([\w\+-]+)/, {
        GET: actions.planMeals,
        POST: actions.managePlan
      }
    ], [
      /^\/foodlist(\/?)\?term=(\w*)/, {
        GET: actions.foodList
      }
    ]
  ];

  require('http').createServer(function(request, response) {
    return web.routeRequest(request, routes).or(web.error404).run(_.inert, (function(err) {
      if (err instanceof Error) {
        web.showMonadErr(err);
        response.write('There was a problem with your request.');
        return response.end();
      }
    }), {
      request: request,
      response: response
    });
  }).listen(1337, '127.0.0.1');

}).call(this);
