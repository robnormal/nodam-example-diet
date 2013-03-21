# Error.stackTraceLimit = Infinity

process.on 'error', (err) ->
  console.log err.stack

_     = require '../nodam/lib/curry.js'
nodam = require '../nodam/lib/nodam-basic.js'
sql   = require '../nodam/lib/sqlite-basic.js'
R     = require '../nodam/lib/restriction.js'

orm   = require './lib/orm.js'
db    = require './model.js'
web   = require './web.coffee'

qs    = require 'querystring'
jade  = require 'jade'

fs = nodam.fs()
M  = nodam.Maybe

GET = 'GET'
POST = 'POST'
PUT = 'PUT'
DELETE = 'DELETE'

dbM = db.dbM
queries = db.queries
fmap = _.flip(_.map)

foodUrl = (food) -> '/food/' + web.wordToUri(food.name)
mealUrl = (meal) -> '/meal/' + meal.id
planUrl = (plan) -> '/plan/' + web.wordToUri(plan.name)

web.helper.foodUrl = foodUrl
web.helper.mealUrl = mealUrl
web.helper.planUrl = planUrl



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
  db.dbRun('DELETE FROM ingredients ' + orm.condition(
    food_id: food.id
    ingredient_id: post['delete']
  ))

createIngredient = (post, food) ->
  db.foodByName(post.ing_name).pipe (ingred) ->
    unless ingred && ingred.id
      return nodam.result()

    db.runQuery(queries.ingredients_insert,
      food_id: food.id
      ingred_id: ingred.id
      grams: post.grams || 0
    )

createMealFood = (meal, post) ->
  db.foodByName(post.food_name).pipe (food) ->
    if !food
      nodam.result(M.left('No food with that name exists.'))
    else
      # if meal food exists, add the grams of the new entry to that
      db.getMealFood(meal.id, food.id).pipe (m_meal_f) ->
        post_grams = parseInt(post.grams, 10)

        M.right(
          if m_meal_f.isJust()
            db.runQuery(queries.meal_foods_update,
              meal_id: meal.id
              food_id: food.id
              grams: m_meal_f.fromJust().grams + post_grams
            )
          else
            db.runQuery(queries.meal_foods_insert, {
              meal_id: meal.id
              food_id: food.id
              grams: post_grams
            })
        )

updateMealFood = (meal, post) ->
  M.right db.runQuery(queries.meal_foods_update,
    meal_id: meal.id
    food_id: post.update
    grams: post.grams
  )

createPlan = (post) ->
  if post.name
    M.right db.runQuery(queries.plans_insert, { name: post.name })
      .then(
        db.dbGet(queries.plans + orm.condition(
          id: orm.literal('last_insert_rowid()')
        ))
      )
  else
    M.left('Invalid form submission.')

addMealToPlan = (post, plan) ->
  unless post.meal_name
    return nodam.result M.left('Invalid form submission.')

  db.mealByName(post.meal_name).pipe (meal) ->
    unless meal
      return nodam.result M.left('No meal exists by that name')

    db.runQuery(queries.plan_meals_insert,
      { plan_id: plan.id, meal_id: meal.id }
    ).then(nodam.result M.right())

removeMealFromPlan = (post, plan) ->
  unless post.removeMeal
    return nodam.result M.left('Invalid form submission.')

  db.dbRun('DELETE FROM plan_meals' + orm.condition(id: post.removeMeal))
    .then(nodam.result M.right())


getLatestMeal = db.dbGet(queries.meals + orm.condition(
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

    db.foodByName(food_name).pipe (food) ->
      if !food
        web.error404
      else if food.type == 'dish'
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
      db.foodByName(food_name).pipe (food) ->
        unless food
          return web.error403('No such food: ' + food_name)
        unless 'dish' == food.type
          return web.error403(food_name + ' cannot have ingredients.')

        m =
          if post['delete']
            deleteIngredient(post, food)
          else if post.create
            createIngredient(post, food)
          else if post.update
            db.runQuery(queries.ingredients_update, post)
          else false

        if m
          m.then(db.updateFoodCals(food))
            .then web.redirect(match[0])
        else
          web.error403 'Invalid form submission.'


  meals: (match) ->
    allMeals.pipe (meals) ->
      web.showView('meals', meals: meals)

  manageMeals: (match) ->
    nodam.combine([dbM, web.getPost]).pipeArray (db_obj, post) ->
      if post['delete']
        db.dbRun('DELETE FROM meals ' + orm.condition(id: post['delete']))
          .then web.redirect('/meals')

      else if post.create
        db.runQuery(queries.meals_insert, { name: post.name })
          .then(getLatestMeal)
          .pipe (meal) -> web.redirect(mealUrl meal)

      # if nothing to do, send back to meals
      else web.redirect '/meals'
        

  meal: (match) ->
    unless match[1]
      return web.error404

    db.mealById(match[1]).pipe (meal) ->
      if !meal
        web.error404
      else
        db.fillMealFoods(meal).pipe (mealFilled) ->
          web.showView('meal', { meal_foods: mealFilled.foods, meal: mealFilled })

  mealFoods: (match) ->
    meal_id = match[1]
    unless meal_id
      return web.error404

    nodam.combine([dbM, web.getPost]).pipeArray (db_obj, post) ->
      mealById(meal_id).pipe (meal) ->
        unless meal
          return web.error403('No meal with that id: ' + meal_id)

        # first, update the name
        e_m =
          if post.meal_name
            db.updateMealName(meal, post.meal_name)
          else if post['delete']
            db.deleteMealFood(meal, post['delete'])
          else if post.create
            createMealFood(meal, post)
          else if post.update
            updateMealFood(meal, post)
          else nodam.result(M.left 'Invalid form submission.')

        e_m.either(
          (m) -> m.then web.redirect(match[0])
          (str) -> web.error403 str
        )

  foodList: (match) ->
    term = match[2]
    (
      if term
        db.dbAll(_.template(
          db.queries.food_list,
          { term: term }
        )).mmap (rows) ->

          if rows
            names = _.map(rows, (row) -> row.name)
            JSON.stringify names
          else
            nodam.result('')

      else
        nodam.result('')
    ).pipe web.success

  plans: (match) ->
    db.dbAll(queries.plans).pipe (plans) ->
      web.showView('plans', plans: plans)

  planMeals: (match) ->
    plan_name = match[1] && web.uriToWord(match[1])

    db.dbGet(queries.plans + orm.condition(name: plan_name)).pipe (plan) ->
      unless plan
        return web.error403('No plan "' + plan_name + '" exists.')

      getPlanMeals(plan).pipe((p_meals) ->
        if p_meals && p_meals.length

          nodam.sequence(_.map(p_meals, (p_meal) ->
            db.fillMealFoods(p_meal.meal).mmap (meal) ->
              _.set(p_meal, 'meal', meal)
          ))
        else
          nodam.result []
      ).pipe (planMealsFilled) ->
        allMeals.pipe (all_meals) ->
          web.showView('plan', {
            plan: db.setPlanCals(_.set(plan, 'p_meals', planMealsFilled))
            all_meals: all_meals
          })


  createPlan: (match) ->
    nodam.combine([dbM, web.getPost]).pipeArray (db_obj, post) ->
      e_m = (post.create && createPlan(post)) || M.left('Invalid form submission.')

      e_m.either(
        (m) -> m.pipe((plan) -> web.redirect planUrl(plan))
        (err) -> web.error403 err
      )

  managePlan: (match) ->
    nodam.combine([dbM, web.getPost]).pipeArray (db_obj, post) ->
      m =
        if post.create
          createPlan(post)
        else
          plan_name = match[1] && web.uriToWord(match[1])

          db.dbGet(queries.plans + orm.condition(name: plan_name)).pipe (plan) ->
            if !plan
              nodam.result M.left('No plan with that id: ' + plan_id)
            else if post['delete']
              deletePlan plan
            else if post.update
              updatePlan(post, plan)
            else if post.addMeal
              addMealToPlan(post, plan)
            else if post.removeMeal
              removeMealFromPlan(post, plan)
            else nodam.result M.left('Invalid form submission.')

      m.pipe (e_m_err) ->
        e_m_err.either(
          # if things went OK, just get out of here
          (x) -> web.redirect(match[0])
          (err) -> web.error403 err
        )

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

require('http').createServer((request, response) ->
# nodam.http().createServer((request, response) ->
  nodam.debug true

  web.routeRequest(request, routes).or(web.error404)
    .run(
      _.inert,
      ((err) ->
        web.showMonadErr err
        response.write 'There was a problem with your request.'
        response.end()
      ),
      { request: request, response: response }
    )
).listen(1337, '127.0.0.1')
