Error.stackTraceLimit = Infinity
# require('longjohn').async_trace_limit = -1

process.on 'error', (err) ->
  console.log err.stack

orm   = require './lib/orm2.js'
db    = require './model.js'
web   = require './web.coffee'

nodam = require 'nodam'
qs    = require 'querystring'
jade  = require 'jade'
util  = require 'util'

_     = nodam._
fs = nodam.fs()
M  = nodam.Maybe
Async = nodam.Async

# nodam.debug true

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
weekUrl = (week) -> '/week/' + web.wordToUri(week.name)

web.helper.foodUrl = foodUrl
web.helper.mealUrl = mealUrl
web.helper.planUrl = planUrl
web.helper.weekUrl = weekUrl

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
  food_id = post.update
  if food_id
    data =
      name: post['food_name_' + food_id]
      type: post['food_type_' + food_id]
      id: food_id

    if post['food_cals_' + food_id]
      data.cals = post['food_cals_' + food_id]
      templ = queries.food_update_cals
    else if post['food_grams_' + food_id]
      data.grams = post['food_grams_' + food_id]
      templ = queries.food_update_grams

    db.runQuery(templ, data)
      .then(db.getFood(food_id))
      .pipeMaybe(
        nodam.failure('An unknown error occured.'),
        db.updateFoodCals
      )

  else
    nodam.failure('No food exists with that ID.')

deleteIngredient = (post, food) ->
  db.run('DELETE FROM ingredients ' + orm.condition(
    food_id: food.id
    ingredient_id: post['delete']
  )).then(db.updateFoodCals(food))


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
      nodam.failure('We have no food called "' + post.food_name + '"')
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
        ordinal: post.ord
      )
  )

removeMealFromPlan = (post, plan) ->
  if post.removeMeal
    db.run('DELETE FROM plan_meals' + orm.condition(id: post.removeMeal))
  else
    nodam.failure 'Invalid form submission.'

reorderPlanMeals = (post, plan) ->
  db.reorderPlanMeals(plan, _.map(post.ords, toInt))


getLatestMeal = db.get(queries.meals + orm.condition(
  id: orm.literal('last_insert_rowid()')
))

createWeek = (post) ->
  if post.name
    db.runQuery(queries.weeks_insert, { name: post.name })
      .then(
        db.getOrFail(queries.weeks + orm.condition(
          id: orm.literal('last_insert_rowid()')
        ))
      )
  else
    nodam.failure 'Invalid form submission.'

getMatchedWeek = (match) ->
  unless match[1]
    return nodam.failure()

  plan_name = match[1] && web.uriToWord(match[1])
  db.get(db.queries.weeks + orm.condition(name: plan_name))

updateWeek = (post, week) ->
  Async.mapM(post.plans, (plan_id, i) ->
    db.setWeekPlan(week, i+1, toInt(plan_id))
  )

actions = {
  root: (match) ->
    orm.Nutrient.get({ name: 'carbohydrates' }).pipeMaybe \
      web.error403('WTF?! Recreate "carbohydrates" nutrient.'),
      (carbs_nut) ->
        orm.allFoods.pipeMapM((food) ->
          orm.foodNutrient(food, carbs_nut).mmap (carbs) ->
            food.set('carbs', carbs)
        ).pipe (foods) ->
          web.showView('foods', foods: foods)

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
      Async.mapM(meals, db.fillMealFoods).pipe (fmeals) ->
        web.showView('meals', meals: fmeals)

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
        db.mealIngredients(meal).pipe (ingreds) ->
          web.showView('meal', {
            meal_foods: mealFilled.foods
            meal: mealFilled
            ingredients: ingreds
          })
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
          logError(err).then(web.error403 err)

  foodList: (match) ->
    term = match[2]
    m =
      if term
        db.allQ(db.queries.food_list, term: term ).mmap (rows) ->
          names = _.map(rows || [], (row) -> row.name)
          JSON.stringify names
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
          db.getPlanMeals(plan).pipeMapM( (p_meal) ->
            db.fillMealFoods(p_meal.meal).mmap( (meal) ->
              _.set(p_meal, 'meal', meal)
            )
          ).pipe (planMealsFilled) ->
            planFilled = _.set(plan, 'p_meals', planMealsFilled)

            db.allMeals.pipe (all_meals) ->
              db.planIngredients(plan).pipe (ingreds) ->
                web.showView('plan',
                  plan: db.setPlanCals(planFilled)
                  all_meals: all_meals
                  ingredients: ingreds
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

        db.get(queries.plans + orm.condition(name: plan_name)).pipeMaybe(
          nodam.failure('No plan with that name: ' + plan_name),
          (plan) ->
            if post.rename && post.plan_name
              db.renamePlan(plan, post.plan_name).pipe (plan1) ->
                web.redirect(planUrl plan1)
            else if post.reorder
              reorderPlanMeals(post, plan)
                .then(web.success 'OK')
            else
              m =
                if post.update
                  updatePlan(post, plan)
                else if post.addMeal
                  addMealToPlan(post, plan)
                else if post.removeMeal
                  removeMealFromPlan(post, plan)
                else nodam.failure 'Invalid form submission.'

              m.then(web.redirect(match[0]))
        ).rescue(web.error403)

  weeks: (match) ->
    db.all(queries.weeks).pipe (weeks) ->
      web.showView('weeks', weeks: weeks)

  week: (match) ->
    getMatchedWeek(match).pipeMaybe(
      web.error404,
      (week) ->
        db.getWeekPlans(week).pipe (w_plans) ->
          db.weekIngredients(week).pipe (ingredients) ->
            db.all(queries.plans).pipe (all_plans) ->
              web.showView('week', {
                week_plans: w_plans
                all_plans: all_plans
                week: week
                ingredients: ingredients
              })
    )

  manageWeek: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray (db_obj, post) ->
      if post['delete']
        db.deleteWeek(post['delete'])
          .then(web.redirect '/weeks')
      else if post.create
        (createWeek post).pipe (new_week) ->
          web.redirect(weekUrl new_week)
      else
        week_name = match[1] && web.uriToWord(match[1])

        db.get(queries.weeks + orm.condition(name: week_name)).pipeMaybe(
          nodam.failure('No week with that name: ' + week_name),
          (week) ->
            if post.rename && post.week_name
              db.renameWeek(week, post.week_name).pipe (week1) ->
                web.redirect(weekUrl week1)
            else if post.update
              updateWeek(post, week)
                .then(web.redirect(match[0]))
            else
              nodam.failure 'Invalid form submission.'
        ).rescue(web.error403)


  weekUpdate: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray (db_obj, post) ->
      db.setWeekPlan(
        toInt(post.week_id),
        toInt(post.ord),
        toInt(post.plan_id)
      ).then(redirect(match[0]))
        .rescue(web.error403)

  createWeek: (match) ->
    nodam.combineStrict([dbM, web.getPost]).pipeArray((db_obj, post) ->
      newWeek =
        if post.create
          createWeek(post)
        else nodam.failure('Invalid form submission.')

      newWeek.pipe((week) ->
        web.redirect(weekUrl week)
      ).rescue((msg) ->
        web.error403(msg)
      )
    )

  nutrients: (match) ->
    orm.Nutrient.find().pipe (nutnts) ->
      web.showView('nutrients', nutrients: nutnts)

  nutrient: (match) ->
    orm.nutrientWithFoods({ 'n_name': match[1] }).pipeMaybe \
      web.error404,
      (nutrient) ->
        web.showView('nutrient',
          f_nutrients: nutrient.food_nutrients
          nutrient: nutrient
        )

  manageNutrient: (match) ->
    changes = web.getPost.pipe (post) ->
      if post['delete']
        orm.deleteNutrient post['delete']
      else if post.create
        orm.createNutrient post.name
      else
        # if nothing to do, send back to main page
        nodam.result()

    changes.then web.redirect('/nutrients')

  foodNutrients: (match) ->
    food_name = web.uriToWord match[1]

    orm.Food.get({ name: food_name }).pipeMaybe \
      web.error404,
      (food) ->
        orm.foodNutrients(food).pipe (nutnts) ->
          web.showView('foodNutrients',
            f_nutrients: nutnts
            food: food
          )

  manageFoodNutrients: (match) ->
    web.getPost.pipe (post) ->
      food_name = web.uriToWord match[1]

      orm.Food.get({ name: food_name }).pipeMaybe(
        web.error403('Could not find food: ' + match[1]),
        (food) ->
          orm.foodNutrients(food).pipe (nutnts) ->
            if post['delete']
              orm.deleteFoodNutrient(food, post['delete'])
            else if post.create
              orm.createFoodNutrient(food, post.name, post.amount)
            else
              # if nothing to do, send back to main page
              nodam.result()
      ).then web.redirect('/nutrientsin/' + match[1])
        .rescue (err) ->
          logError(err).then(web.error403 err)

  mealNutrients: (match) ->
    meal_name = web.uriToWord match[1]
    orm.Meal.get({ name: meal_name }).pipeMaybe(
      web.error403('could not find meal ' + meal_name),
      (meal) ->
        orm.allNutrientsIn(orm.mealIngredients(meal)).pipe (amts) ->
          web.showView('mealNutrients', {
            meal: meal
            amts: amts
          })
    )

  planNutrient: (match) ->
    plan_name = web.uriToWord match[1]
    nut_name = web.uriToWord match[2]
    orm.Plan.get({ name: plan_name }).pipeMaybe(
      web.error403('could not find ' + plan_name),
      (plan) ->
        orm.Nutrient.get({ name: nut_name }).pipeMaybe(
          web.error403('could not find ' + nut_name),
          (nutrient) ->
            orm.planNutrientAmount(plan, nutrient).pipe (amount) ->
              web.success(plan.name + ' has ' + amount + ' ' + nut_name)
        )
    )

  nutrientRatio2: (match) ->
    nut1_m = orm.Nutrient.get({ name: match[1] })
    nut2_m = orm.Nutrient.get({ name: match[2] })
    food_m = orm.Food.get({ name: match[3] })

    nodam.combine([nut1_m, nut2_m, food_m]).pipeArray (m_nut1, m_nut2, m_food) ->
      if m_nut1.isNothing()
        web.error403('No such nutrient: ' + match[1])
      else if m_nut2.isNothing()
        web.error403('No such nutrient: ' + match[2])
      else if m_food.isNothing()
        web.error403('No such food: ' + match[3])
      else
        [nut1, nut2, food] = M.Maybe.concat([m_nut1, m_nut2, m_food])

        orm.nutrientPerNutrient(nut1.id, nut2.id, food.id).pipe (ratio) ->
          web.success(
            m_food.fromJust().name + ' has ' + ratio + ' ' +
            nut1.name + ' per ' + nut2.name
          )

  nutrientRatio: (match) ->
    orm.Nutrient.get({ name: match[1] }).pipeMaybe \
      web.error403('No such nutrient: ' + match[1]),
      (nut1) ->
        orm.Nutrient.get({ name: match[2] }).pipeMaybe \
        web.error403('No such nutrient: ' + match[2]),
        (nut2) ->
          food_m = orm.Food.get({ name: match[3] }).pipeMaybe \
            web.error403('No such food: ' + match[3]),
            (food) ->
              orm.nutrientPerNutrient(nut1.id, nut2.id, food.id).pipe (ratio) ->
                web.success(
                  m_food.fromJust().name + ' has ' + ratio + ' ' +
                  nut1.name + ' per ' + nut2.name
                )

  ratioRanking: (match) ->
    orm.Nutrient.get({ name: match[1] }).pipeMaybe \
      web.error403('No such nutrient: ' + match[1]),
      (nut1) ->
        orm.Nutrient.get({ name: match[2] }).pipeMaybe \
        web.error403('No such nutrient: ' + match[2]),
        (nut2) ->
          orm.ratioRank(nut1.id, nut2.id).pipe (food_ratios) ->
            web.showView('ratioRank', {
              nutrient_1: nut1
              nutrient_2: nut2
              food_ratios: food_ratios
            })


  staticFile: (match) ->
    serveFile match[0]
}

mimeTypes = {
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  js: 'text/javascript',
  css: 'text/css'
}

path = require('path')

endsWith = (str, suffix) ->
  str.indexOf(suffix, str.length - suffix.length) != -1

serveCompressed = (file) ->
  getServePath =
    if endsWith(file, '.css') || endsWith(file, '.js')
      fs.exists(file + '.gz').pipe (bool) ->
        serve = if bool then file + '.gz' else file

        nodam.result serve
    else
      nodam.result file
      
  getServePath.pipe (serve) ->
    fileStream = fs.createReadStream(serve)

    nodam.get('response').pipe (resp) ->
      Async.listen(fileStream, 'error', (err) ->
        resp.status = 404
        resp.write 'File not found.'

        nodam.failure(resp.end())
      ).pipe ->
        mime = mimeTypes[path.extname(serve).substr(1)]

        resp.status = 200
        resp.setHeader('Content-Type', mime)
        nodam.result(fileStream.pipe resp)


serveFile = (file) ->
  filepath = __dirname + '/' + file

  serveCompressed(filepath)

routes = [
  [ '/',                   { GET: actions.root }]
  [ /^\/food\/(.+)/,       { GET: actions.ingredients, POST: actions.manageIngredients }]
  [ /^\/food(\/?)$/,       { POST: actions.food }]
  [ /^\/meals(\/?)$/,      { GET: actions.meals }]
  [ /^\/meal\/(\d+)/,      { GET: actions.meal, POST: actions.mealFoods }]
  [ /^\/meal(\/?)$/,       { POST: actions.manageMeals }]
  [ /^\/plans(\/?)$/,      { GET: actions.plans }]
  [ /^\/plan(\/?)$/,       { POST: actions.managePlan }]
  [ /^\/plan\/(.+)/,       { GET: actions.planMeals, POST: actions.managePlan }]
  [ /^\/weeks(\/?)$/,      { GET: actions.weeks }]
  [ /^\/week(\/?)$/,       { POST: actions.manageWeek }]
  [ /^\/week\/(.+)/,       { GET: actions.week, POST: actions.manageWeek }]

  [ /^\/nutrientsin\/(.+)/,   { GET: actions.foodNutrients, POST: actions.manageFoodNutrients }]
  [ /^\/nutrients(\/?)$/,      { GET: actions.nutrients }]
  [ /^\/nutrient-ratio\/(.+)\/(.+)\/(.+)/, { GET: actions.nutrientRatio }]
  [ /^\/nutrient-ratios\/(.+)\/(.+)/, { GET: actions.ratioRanking }]
  [ /^\/nutrient(?:\/(.+)?)?/,       { GET: actions.nutrient, POST: actions.manageNutrient }]

  [ /^\/meal-nutrients\/(.+)/, { GET: actions.mealNutrients }]
  [ /^\/plan-nutrient\/(.+)\/(.+)/, { GET: actions.planNutrient }]


  [ /^\/foodlist(\/?)\?term=(\w*)/, { GET: actions.foodList }],
  [ /^\/(assets\/.*)/, { GET: actions.staticFile } ]
]

# nodam.http().createServer((request, response) ->
require('http').createServer((request, response) ->
  web.routeRequest(request, routes).or(web.error404)
    .run(
      (_.inert),
      ((err) ->
        if (err instanceof Error)
          web.showMonadErr err
          response.write 'There was a problem with your request.'
          response.end()
      ),
      { request: request, response: response }
    )
).listen(1337)
