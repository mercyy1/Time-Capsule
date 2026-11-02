const request = require("supertest");
const { app } = require("./app");

let count = 0;

// Signs up a new user through the API. Returns the response body
// ({ token, user }) plus `auth`, the value for the Authorization header.
async function signUp(email = `user${++count}@example.com`, password = "password123") {
  const res = await request(app).post("/signup").send({ email, password }).expect(201);
  return { ...res.body, auth: `Bearer ${res.body.token}` };
}

module.exports = { signUp };
