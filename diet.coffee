Error.stackTraceLimit = Infinity
# require('longjohn').async_trace_limit = -1

process.on 'error', (err) ->
  console.log err.stack

_     = require '../nodam/lib/curry.js'
nodam = require '../nodam/lib/nodam.js'
sql   = require '../nodam/lib/sqlite.js'
R     = require '../nodam/lib/restriction.js'

orm   = require './lib/orm.js'
db    = require './model.js'
web   = require './web.coffee'

qs    = require 'querystring'
jade  = require 'jade'

fs = nodam.fs()
M  = nodam.Maybe

nodam.debug true

GET = 'GET'
POST = 'POST'
PUT = 'PUT'
DELETE = 'DELETE'

dbM = db.dbM
queries = db.queries
fmap = _.flip(_.map)
toInt = db.toInt

foodUrl = (food) -> '/food/' + web.wordToUri(food.name)
mealUrl = (meal) -> '/meal/' + meal.id
planUrl = (plan) -> '/plan/' + web.wordToUri(plan.name)

web.helper.foodUrl = foodUrl
web.helper.mealUrl = mealUrl
web.helper.planUrl = planUrl

apology = 'Sorry, there was a problem with your request.'

# for now, do nothing here
logError = (err) ->
  console.log(err)
  console.log(err.stack)
  nodam.result()

createFood = (post) ->
  db.runQuery(queries.foods_insert,
    name: post.food_name
    type: post.food_type
    cals: post.food_cals || ''
    grams: post.food_grams || ''
  )

updateFood = (post) ->
  db.runQuery(queries.foods_update,
    name: post.food_name
    type: post.food_type
    cals: post.food_cals || ''
    grams: post.food_grams || ''
    id: post.update
  )

deleteIngredient = (post, food) ->
  db.run('DELETE FROM ingredients ' + orm.condition(
    food_id: food.id
    ingredient_id: post['delete']
  ))


addIngredient = (post, food) ->
  db.addIngredient(food, post.ing_name, toInt(post.grams) || 0)
    .rescue () ->
      web.error403('No ingredient called "' + post.ing_name + '" was found.')

updateIngredient = (post, food) ->
  db.runQuery(queries.ingredients_update,
    food_id: post.food_id
    grams: post.grams
    ingred_id: post.update
  ).then(db.updateFoodCals(food))

createMealFood = (meal, post) ->
  if !meal.id
    nodam.failure 'No meal with that ID exists.'
  else
    post_grams = toInt(post.grams || 0)

    db.foodByName(post.food_name).pipeMaybe(
      nodam.failure('No food with that name exists.'),
      (food) ->
        # if meal food exists, add the grams of the new entry to that
        db.getMealFood(meal.id, food.id).pipe( (m_meal_food) ->
          if m_meal_food.isNothing()
            db.runQuery(queries.meal_foods_insert,
              meal_id: meal.id
              food_id: food.id
              grams: post_grams
            )
          else
            db.runQuery(queries.meal_foods_update,
              meal_id: meal.id
              food_id: food.id
              grams: m_meal_food.fromJust().grams + post_grams
            )
        )
    )

updateMealFood = (meal, post) ->
  db.runQuery(queries.meal_foods_update,
    meal_id: meal.id
    food_id: post.update
    grams: post.grams
  )

createPlan = (post) ->
  if post.name
    db.runQuery(queries.plans_insert, { name: post.name })
      .then(
        db.getOrFail(queries.plans + orm.condition(
          id: orm.literal('last_insert_rowid()')
        ))
      )
  else
    nodam.failure 'Invalid form submission.'

addMealToPlan = (post, plan) ->
  unless post.meal_name
    return nodam.failure 'Invalid form submission.'

  db.mealByName(post.meal_name).pipeMaybe(
    nodam.failure('No meal exists by that name'),
    (meal) ->
      db.runQuery(queries.plan_meals_insert,
        plan_id: plan.id
        meal_id: meal.id
      )
  )

removeMealFromPlan = (post, plan) ->
  if post.removeMeal
    db.run('DELETE FROM plan_meals' + orm.condition(id: post.removeMeal))
  else
    nodam.failure 'Invalid form submission.'



getLatestMeal = db.get(queries.meals + orm.condition(
  id: orm.literal('last_insert_rowid()')
))

actions = {
  root: (match) ->
    db.allFoods.pipe (rows) ->
      web.showView('foods', foods: rows)

  food: (match) ->
    changes = web.getPost.pipe (post) ->
      if post['delete']
        db.deleteFood post['delete']
      else if post.create
        createFood post
      else if post.update
        updateFood post
      else
        # if nothing to do, send back to main page
        nodam.result()

    changes.then web.redirect('/')


  ingredients: (match) ->
    food_name = match[1] && web.uriToWord(match[1])
    unless food_name
      return web.error404

    db.foodByName(food_name).pipeMaybe \
      web.error404,
      (food) ->
        if food.type == 'dish'
          db.ingredientsForFood(food).pipe (food2) ->
            web.showView('ingredients',
              ingredients: food2.ingredients
              food: food2
              food_url: foodUrl(food2)
            )
        else
          nodam.result(food.name + ' has no ingredients.')

  manageIngredients: (match) ->
    food_name = match[1] && web.uriToWord(match[1])

    unless food_name
      return web.error404

    web.getPost.pipe (post) ->
      db.foodByName(food_name).pipeMaybe(
        web.error403('No such food: ' + food_name),
        (food) ->
          changes =
            if 'dish' != food.type
              web.error403(food_name + ' cannot have ingredients.')
            else if post['delete']
              deleteIngredient(post, food)
            else if post.create
              addIngredient(post, food)
            else if post.update
              updateIngredient(post, food)
            else
              web.error403 'Invalid form submission.'

          changes.then(web.redirect(match[0]))
        )


  meals: (match) ->
    db.allMeals.pipe (meals) ->
      web.showView('meals', meals: meals)

  manageMeals: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray (db_obj, post) ->
      if post['delete']
        db.deleteMeal(post['delete'])
          .then web.redirect('/meals')

      else if post.create
        db.runQuery(queries.meals_insert, { name: post.name })
          .then(getLatestMeal)
          .pipeMaybe(
            web.error403(apology),
            (meal) -> web.redirect(mealUrl meal)
          )

      # if nothing to do, send back to meals
      else web.redirect '/meals'


  meal: (match) ->
    unless match[1]
      return web.error404

    db.mealById(match[1]).pipeMaybe(web.error404, (meal) ->
      db.fillMealFoods(meal).pipe (mealFilled) ->
        web.showView('meal', { meal_foods: mealFilled.foods, meal: mealFilled })
    )

  mealFoods: (match) ->
    meal_id = match[1]
    unless meal_id
      return web.error404

    nodam.combineStrict([dbM, web.getPost]).pipeArray (db_obj, post) ->
      changes = db.mealById(meal_id).pipeMaybe(
        nodam.failure('No meal with that id: ' + meal_id),
        (meal) ->
          if post.meal_name
            db.updateMealName(meal, post.meal_name)
          else if post['delete']
            db.deleteMealFood(meal, post['delete'])
          else if post.create
            createMealFood(meal, post)
          else if post.update
            updateMealFood(meal, post)
          else
            nodam.failure 'Invalid form submission.'
      )

      changes.then(web.redirect match[0])
        .rescue (err) ->
          logError(err).then(web.error403 apology)

  foodList: (match) ->
    term = match[2]
    m =
      if term
        db.allQ(db.queries.food_list, term: term ).mmap (rows) ->
          if rows
            names = _.map(rows, (row) -> row.name)
            JSON.stringify names
          else
            nodam.result('')
      else
        nodam.result('')
    
    m.pipe web.success

  plans: (match) ->
    db.all(queries.plans).pipe (plans) ->
      web.showView('plans', plans: plans)

  planMeals: (match) ->
    plan_name = match[1] && web.uriToWord(match[1])

    db.get(
      queries.plans + orm.condition(name: plan_name)
    ).pipeMaybe(
      web.error403('No plan "' + plan_name + '" exists.'),
      (plan) ->
        db.getPlanMeals(plan).pipe( (p_meals) ->
          if p_meals.length
            nodam.mapM(p_meals, (p_meal) ->
              db.fillMealFoods(p_meal.meal).mmap( (meal) ->
                _.set(p_meal, 'meal', meal)
              )
            )
          else nodam.result([])
        ).pipe (planMealsFilled) ->
          planFilled = _.set(plan, 'p_meals', planMealsFilled)

          db.allMeals.pipe (all_meals) ->
            web.showView('plan',
              plan: db.setPlanCals(planFilled)
              all_meals: all_meals
            )
    )

  createPlan: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray((db_obj, post) ->
      newPlan =
        if post.create
          createPlan(post)
        else nodam.failure('Invalid form submission.')

      newPlan.pipe((plan) ->
        console.log('plan:', plan)
        web.redirect(planUrl plan)
      ).rescue((msg) ->
        console.log('msg:', msg)
        web.error403(msg)
      )
    )

  managePlan: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray (db_obj, post) ->
      if post['delete']
        db.deletePlan(post['delete'])
          .then(web.redirect '/plans')
      else if post.create
        (createPlan post).pipe (new_plan) ->
          web.redirect(planUrl new_plan)
      else
        plan_name = match[1] && web.uriToWord(match[1])

        m = db.get(queries.plans + orm.condition(name: plan_name)).pipeMaybe(
          nodam.failure('No plan with that name: ' + plan_name),
          (plan) ->
            if post.update
              updatePlan(post, plan)
            else if post.addMeal
              addMealToPlan(post, plan)
            else if post.removeMeal
              removeMealFromPlan(post, plan)
            else nodam.failure 'Invalid form submission.'
        )

        m.then(web.redirect(match[0]))
          .rescue(web.error403)

}


routes = [
  [ '/',                  { GET: actions.root }]
  [ /^\/food\/([\w\+-]+)/, { GET: actions.ingredients, POST: actions.manageIngredients }]
  [ /^\/food(\/?)$/,       { POST: actions.food }]
  [ /^\/meals(\/?)$/,      { GET: actions.meals }]
  [ /^\/meal\/(\d+)/,      { GET: actions.meal, POST: actions.mealFoods }]
  [ /^\/meal(\/?)$/,       { POST: actions.manageMeals }]
  [ /^\/plans(\/?)$/,       { GET: actions.plans }]
  [ /^\/plan(\/?)$/,       { POST: actions.managePlan }]
  [ /^\/plan\/([\w\+-]+)/, { GET: actions.planMeals, POST: actions.managePlan }]

  [ /^\/foodlist(\/?)\?term=(\w*)/,   { GET: actions.foodList }]
]

# nodam.http().createServer((request, response) ->
require('http').createServer((request, response) ->
  web.routeRequest(request, routes).or(web.error404)
    .run(
      _.inert,
      ((err) ->
        if (err instanceof Error)
          web.showMonadErr err
          response.write 'There was a problem with your request.'
          response.end()
      ),
      { request: request, response: response }
    )
).listen(1337, '127.0.0.1')
