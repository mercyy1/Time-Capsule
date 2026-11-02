// Any error thrown in a route (Express 5 also forwards rejected promises here)
// gets a JSON 500 instead of an HTML stack trace. Express treats a middleware
// as an error handler only if it takes four arguments, so `_next` must stay.
function errorHandler(err, req, res, _next) {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
}

module.exports = { errorHandler };
