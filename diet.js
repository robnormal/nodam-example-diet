// Generated by CoffeeScript 1.6.1
(function() {
  var DELETE, GET, M, POST, PUT, R, actions, createFood, createIngredient, createMealFood, createPlan, dbAll, dbFunction, dbGet, dbM, dbQueryFunction, dbRun, deleteFood, deleteIngredient, deleteMealFood, display, error403, error404, fmap, foodUrl, fs, getIngredients, getJade, getPost, getView, helper, jade, logError, matchUrl, mealUrl, model, nodam, orm, planUrl, qs, queries, redirect, routeRequest, routes, runQuery, setMealCals, showMonadErr, showView, sql, success, updateFood, updateMealFood, uriToWord, wordToUri, _,
    __slice = [].slice;

  Error.stackTraceLimit = Infinity;

  process.on("error", function(err) {
    return console.log(err.stack);
  });

  _ = require("../nodam/lib/curry.js");

  nodam = require("../nodam/lib/nodam.js");

  sql = require("../nodam/lib/sqlite.js");

  R = require('../nodam/lib/restriction.js');

  orm = require("./lib/orm.js");

  model = require("./model.js");

  qs = require("querystring");

  jade = require("jade");

  fs = nodam.fs();

  M = nodam.Maybe;

  GET = "GET";

  POST = "POST";

  PUT = "PUT";

  DELETE = "DELETE";

  dbM = model.dbM;

  queries = model.queries;

  fmap = _.flip(_.map);

  logError = function(msg) {
    return fs.writeFile('errors.log', msg);
  };

  runQuery = function(tmpl, data) {
    R.manualCheck(tmpl && (typeof tmpl === 'string'), 'Expected query template');
    return dbM.pipe(function(db) {
      return db.run(_.template(tmpl, data));
    });
  };

  dbFunction = function(name) {
    return function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return dbM.pipe(function(db_obj) {
        return db_obj[name].apply(db_obj, args);
      });
    };
  };

  dbQueryFunction = function(name) {
    return function() {
      var args, query;
      query = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      R.manualCheck(query && (typeof query === 'string'), 'Expected SQL query');
      return dbM.pipe(function(db_obj) {
        return db_obj[name].apply(db_obj, [query].concat(__slice.call(args)));
      });
    };
  };

  dbGet = dbQueryFunction('get');

  dbAll = dbQueryFunction('all');

  dbRun = dbQueryFunction('run');

  showMonadErr = function(err) {
    var m;
    console.log(err.message);
    console.log(err.stack);
    if (err.monad) {
      m = _.clone(err.monad);
      delete m.stack_at_origin;
      console.log(m);
      return console.log('Stack at origin:', err.monad.stack_at_origin);
    }
  };

  getJade = function(file, data) {
    return fs.readFile(file, 'ascii').pipe(function(view) {
      return nodam.result(jade.compile(view)(data));
    });
  };

  error404 = nodam.get('response').pipe(function(resp) {
    resp.status = 404;
    resp.write('Could not find requested URL');
    return nodam.result(resp.end());
  });

  error403 = function(msg) {
    return nodam.get('response').pipe(function(resp) {
      resp.status = 404;
      resp.write(msg);
      return nodam.result(resp.end());
    });
  };

  getPost = nodam.get('request').pipe(function(req) {
    var postData;
    if (req.method === POST) {
      postData = '';
      req.on('data', function(data) {
        if (postData.length < 1000) {
          return postData += data;
        }
      });
      return new nodam.AsyncMonad(function(r, f, s) {
        return req.on('end', function() {
          return r(qs.parse(postData), s);
        });
      });
    } else {
      return nodam.result([]);
    }
  });

  redirect = function(url) {
    return nodam.get('response').pipe(function(resp) {
      resp.statusCode = 302;
      resp.setHeader('Location', url);
      return nodam.result(resp.end());
    });
  };

  display = function(resp, text) {
    resp.setHeader('Content-Type', 'text/html');
    resp.setHeader('Content-Length', text.length);
    resp.write(text);
    return resp;
  };

  success = function(text) {
    return nodam.get('response').pipe(function(resp) {
      resp.statusCode = 200;
      return nodam.result(display(resp, text).end());
    });
  };

  wordToUri = function(word) {
    return word.replace(RegExp(' ', 'g'), '+');
  };

  uriToWord = function(word) {
    return word.replace(/\+/g, ' ');
  };

  matchUrl = function(regexOrString, url) {
    if (regexOrString instanceof RegExp) {
      return url.match(regexOrString);
    } else {
      if (url === regexOrString) {
        return [url];
      } else {
        return null;
      }
    }
  };

  routeRequest = function(request, routes) {
    var action, i, len, match, method, url;
    url = decodeURIComponent(request.url);
    method = request.method;
    len = routes.length;
    i = 0;
    while (i < len) {
      match = matchUrl(routes[i][0], url);
      if (match) {
        action = routes[i][1] && routes[i][1][method];
        if (action) {
          return M.just(action(match));
        }
      }
      i++;
    }
    return M.nothing;
  };

  foodUrl = function(food) {
    return '/food/' + wordToUri(food.name);
  };

  mealUrl = function(meal) {
    return '/meal/' + meal.id;
  };

  planUrl = function(plan) {
    return '/plan/' + wordToUri(plan.name);
  };

  setMealCals = function(meal) {
    var cals;
    cals = _.reduce(meal.foods, function(memo, m_food) {
      return memo + m_food.cals;
    }, 0);
    return _.set(meal, 'cals', cals);
  };

  helper = {
    number: function(digits, num) {
      var strs;
      strs = (num + '').split('.');
      return strs[0] + (strs[1] ? '.' + strs[1].slice(0, digits) : '');
    },
    foodUrl: foodUrl,
    mealUrl: mealUrl,
    planUrl: planUrl
  };

  getView = function(view, data) {
    return getJade('views/' + view + '.jade', _.set(data, 'help', helper));
  };

  showView = function(view, data) {
    return getView(view, data).pipe(success);
  };

  deleteFood = function(post) {
    return dbRun('DELETE FROM foods ' + orm.condition({
      id: post['delete']
    }));
  };

  createFood = function(post) {
    return runQuery(queries.foods_insert, {
      name: post.food_name,
      type: post.food_type,
      cals: post.food_cals || '',
      grams: post.food_grams || ''
    });
  };

  updateFood = function(post) {
    return runQuery(queries.foods_update, {
      name: post.food_name,
      type: post.food_type,
      cals: post.food_cals || '',
      grams: post.food_grams || '',
      id: post.update
    });
  };

  getIngredients = function(food) {
    var m;
    return m = food.type === 'dish' ? model.ingredientsForFood(food).pipe(function(food2) {
      return getView('ingredients', {
        ingredients: food2.ingredients,
        food: food2,
        food_url: foodUrl(food2)
      });
    }) : nodam.result(food.name + ' has no ingredients.');
  };

  deleteIngredient = function(post, food) {
    return dbRun('DELETE FROM ingredients ' + orm.condition({
      food_id: food.id,
      ingredient_id: post['delete']
    }));
  };

  createIngredient = function(post, food) {
    return model.foodByName(post.ing_name).pipe(function(ingred) {
      if (!(ingred && ingred.id)) {
        return nodam.result();
      }
      return runQuery(queries.ingredients_insert, {
        food_id: food.id,
        ingred_id: ingred.id,
        grams: post.grams || 0
      });
    });
  };

  deleteMealFood = function(meal_id, food_id) {
    return dbRun('DELETE FROM meal_foods ' + orm.condition({
      meal_id: meal_id,
      food_id: post_id
    }));
  };

  createMealFood = function(meal, post) {
    return model.foodByName(post.food_name).pipe(function(food) {
      if (!food) {
        return nodam.result();
      } else {
        return model.getMealFood(meal.id, food.id).pipe(function(m_food) {
          var post_grams;
          post_grams = parseInt(post.grams, 10);
          if (m_food) {
            return runQuery(queries.meal_foods_update, {
              meal_id: meal.id,
              food_id: food.id,
              grams: m_food.grams + post_grams
            });
          } else {
            return runQuery(queries.meal_foods_insert, {
              meal_id: meal.id,
              food_id: food.id,
              grams: post_grams
            });
          }
        });
      }
    });
  };

  updateMealFood = function(meal, post) {
    return runQuery(queries.meal_foods_update, {
      meal_id: meal.id,
      food_id: post.update,
      grams: post.grams
    });
  };

  actions = {
    root: function(match) {
      return model.allFoods.pipe(function(rows) {
        return showView('foods', {
          foods: rows
        });
      });
    },
    food: function(match) {
      var changes;
      changes = getPost.pipe(function(post) {
        if (post['delete']) {
          return deleteFood(post);
        } else if (post.create) {
          return createFood(post);
        } else if (post.update) {
          return updateFood(post);
        } else {
          return nodam.result();
        }
      });
      return changes.then(redirect('/'));
    },
    ingredients: function(match) {
      var food_name;
      food_name = match[1] && uriToWord(match[1]);
      if (!food_name) {
        return error404;
      }
      return model.foodByName(food_name).pipe(function(food) {
        if (!food) {
          return error404;
        } else {
          return getIngredients(food).pipe(success);
        }
      });
    },
    manageIngredients: function(match) {
      var food_name;
      food_name = match[1] && uriToWord(match[1]);
      if (!food_name) {
        return error404;
      }
      return getPost.pipe(function(post) {
        return model.foodByName(food_name).pipe(function(food) {
          var m;
          if (!food) {
            return error403('No such food: ' + food_name);
          }
          if ('dish' !== food.type) {
            return error403(food_name + ' cannot have ingredients.');
          }
          m = post['delete'] ? deleteIngredient(post, food) : post.create ? createIngredient(post, food) : post.update ? runQuery(queries.ingredients_update, post) : false;
          if (m) {
            return m.then(model.updateFoodCals(food)).then(redirect(match[0]));
          } else {
            return error403('Invalid form submission.');
          }
        });
      });
    },
    meals: function(match) {
      return dbAll(queries.meals + ' ORDER BY created_at DESC').pipe(function(meals) {
        return showView('meals', {
          meals: meals
        });
      });
    },
    manageMeals: function(match) {
      return nodam.combine([dbM, getPost]).pipeArray(function(db_obj, post) {
        if (post['delete']) {
          return db_obj.run('DELETE FROM meals ' + orm.condition({
            id: post['delete']
          })).then(redirect('/meals'));
        } else if (post.create) {
          return db_obj.run(queries.meals_insert).then(db_obj.get(queries.meals + orm.condition({
            id: orm.literal('last_insert_rowid()')
          }))).pipe(_.compose(redirect, mealUrl));
        } else {
          return redirect('/meals');
        }
      });
    },
    meal: function(match) {
      if (!match[1]) {
        return error404;
      }
      return dbGet(queries.meals + orm.condition({
        id: match[1]
      })).pipe(function(meal) {
        if (!meal) {
          return error404;
        } else {
          return dbAll(queries.meal_foods_with_foods + orm.condition({
            meal_id: meal.id
          })).mmap(_.curry(fmap, model.hydrateMealFood)).pipe(function(meal_foods) {
            var meal2, meal3;
            meal2 = _.set(meal, 'foods', meal_foods);
            meal3 = setMealCals(meal2);
            return showView('meal', {
              meal_foods: meal_foods,
              meal: meal3
            });
          });
        }
      });
    },
    mealFoods: function(match) {
      var meal_id;
      meal_id = match[1];
      if (!meal_id) {
        return error404;
      }
      return nodam.combine([dbM, getPost]).pipeArray(function(db_obj, post) {
        return dbGet(queries.meals + orm.condition({
          id: meal_id
        })).pipe(function(meal) {
          var e_m;
          if (!meal) {
            return error403('No meal with that id: ' + meal_id);
          }
          e_m = post['delete'] ? M.right(deleteMealFood(meal_id, post['delete'])) : post.create ? M.right(createMealFood(meal, post)) : post.update ? M.right(updateMealFood(meal, post)) : M.left('Invalid form submission.');
          return e_m.fromEither(function(m) {
            return m.then(redirect(match[0]));
          }, function(str) {
            return error403(str);
          });
        });
      });
    },
    foodList: function(match) {
      var term;
      term = match[2];
      return (term ? dbAll(_.template(model.queries.food_list, {
        term: term
      })).mmap(function(rows) {
        if (rows) {
          return JSON.stringify(_.map(rows, function(row) {
            return row.name;
          }));
        } else {
          return nodam.result('');
        }
      }) : nodam.result('')).pipe(success);
    },
    plans: function(match) {
      return dbAll(queries.plans).pipe(function(plans) {
        return showView('plans', {
          plans: plans
        });
      });
    },
    planMeals: function(match) {
      return nodam.result('Yay!').pipe(success);
    },
    createPlan: function(match) {
      return nodam.combine([dbM, getPost]).pipeArray(function(db_obj, post) {
        var e_m;
        e_m = post.create ? createPlan(post) : M.left('Invalid form submission.');
        return e_m.either(function(m) {
          return m.pipe(_.compose(redirect, planUrl));
        }, function(err) {
          return error403(err);
        });
      });
    },
    managePlan: function(match) {
      return nodam.combine([dbM, getPost]).pipeArray(function(db_obj, post) {
        var m;
        m = post.create ? createPlan(post) : dbGet(queries.plans + orm.condition({
          id: plan_id
        })).pipe(function(plan) {
          if (!plan) {
            return nodam.result(M.left('No plan with that id: ' + plan_id));
          } else if (post['delete']) {
            return deletePlan(plan);
          } else if (post.update) {
            return updatePlan(plan, post);
          } else {
            return nodam.result(M.left('Invalid form submission.'));
          }
        });
        return m.pipe(function(e_m_err) {
          return e_m_err.either(function(m) {
            return m.then(redirect(match[0]));
          }, function(err) {
            return error403(err);
          });
        });
      });
    }
  };

  createPlan = function(post) {
    var m;
    if (post.name) {
      return m = runQuery(model.queries.plans_insert, {
        name: post.name
      }).then(dbGet(queries.plans + orm.condition({
        id: orm.literal('last_insert_rowid()')
      }))).rescue(function(err) {
        /*
        # this is what should be done - log in its own thread, since
        # we don't need the result
        # logError(err).run()
        # nodam.result('There was a problem with your plan.'
        */
        return logError(err).then(nodam.result('There was a problem with your plan.'));
      });
    } else {
      return nodam.result(M.left('Invalid form submission.'));
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

  nodam.http().createServer(function(request, response) {
    nodam.debug(true);
    return routeRequest(request, routes).or(error404).run(_.inert, (function(err) {
      showMonadErr(err);
      response.write('There was a problem with your request.');
      return response.end();
    }), {
      request: request,
      response: response
    });
  }).listen(1337, '127.0.0.1');

}).call(this);
