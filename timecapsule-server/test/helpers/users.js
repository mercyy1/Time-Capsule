const request = require("supertest");
const { app, mailer, settle } = require("./app");
const { linkToken } = require("./mailer");

let count = 0;

// Signs up through the API the way a person does: signs up, opens the link in
// the confirmation email, logs in. Returns the login's response body
// ({ token, user }) plus `auth`, the value for the Authorization header.
async function signUp(email = `user${++count}@example.com`, password = "password123") {
  await request(app).post("/signup").send({ email, password }).expect(202);
  await settle();
  const token = linkToken(mailer.to(email).at(-1), "verify-email");
  await request(app).post("/verify-email").send({ token }).expect(200);
  const res = await request(app).post("/login").send({ email, password }).expect(200);
  return { ...res.body, auth: `Bearer ${res.body.token}` };
}

module.exports = { signUp };
