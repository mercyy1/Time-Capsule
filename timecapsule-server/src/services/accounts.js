// The account flows that go through email: signing up and confirming the
// address.
const { prisma } = require("../db");
const templates = require("../email/templates");
const { createUser, findUserByEmail, hashPassword } = require("./users");
const { createAuthToken, deleteAuthToken, findAuthToken } = require("./authTokens");

// `sender` sends within the email limits (../email/sender.js); `appUrl` is the
// web client's address, for links.
function createAccounts({ sender, appUrl }) {
  // Emails a link that confirms the user's address. Opening it also sets the
  // password chosen when it was sent (`passwordHash`). Each new link replaces the
  // earlier ones, and its password becomes the one logging in checks. When a
  // sending limit is reached, nothing changes: the links already sent still work.
  async function sendConfirmation(user, passwordHash) {
    const { slot } = await sender.reserve({
      kind: "VERIFY_EMAIL",
      address: user.email,
      userId: user.id,
    });
    if (!slot) return;

    const { token, record } = await createAuthToken({
      kind: "VERIFY_EMAIL",
      userId: user.id,
      passwordHash,
    });
    const { sent } = await sender.deliver(
      slot,
      templates.confirmEmail({ link: `${appUrl}/verify-email#token=${token}` }),
    );
    if (!sent) {
      await deleteAuthToken(record.id);
      return;
    }

    const now = new Date();
    await prisma.$transaction([
      // Older links stop working. Only older ones: if two were sent at the same
      // moment, the newer one must survive.
      prisma.authToken.updateMany({
        where: { userId: user.id, kind: "VERIFY_EMAIL", usedAt: null, id: { lt: record.id } },
        data: { usedAt: now },
      }),
      prisma.user.updateMany({
        where: { id: user.id, emailVerifiedAt: null },
        data: { password: passwordHash },
      }),
    ]);
  }

  async function sendAccountExists(user) {
    const { slot } = await sender.reserve({
      kind: "ACCOUNT_EXISTS",
      address: user.email,
      userId: user.id,
    });
    if (slot) await sender.deliver(slot, templates.accountExists({ appUrl }));
  }

  // Signing up, after the response was sent. A new address gets an account and a
  // confirmation link. An address whose account isn't confirmed gets a new link,
  // which sets this signup's password when opened (so a stranger's earlier
  // signup can't choose the password of the owner's account). A confirmed
  // account isn't touched: its owner gets an email saying someone tried.
  async function signUp(email, password) {
    const passwordHash = await hashPassword(password);
    const user = (await createUser(email, passwordHash)) ?? (await findUserByEmail(email));
    if (!user) return; // deleted in the meantime
    if (user.emailVerifiedAt) return sendAccountExists(user);
    return sendConfirmation(user, passwordHash);
  }

  // Confirms the address a link was sent to, and sets the link's password.
  // Returns the user once their address is confirmed, also when it already was
  // (a link opened twice, or by an email scanner first, still says "confirmed"),
  // or null if the link doesn't work: unknown, expired, or replaced by a newer
  // one.
  async function confirmEmail(token) {
    const link = await findAuthToken("VERIFY_EMAIL", token);
    if (!link) return null;
    if (link.user.emailVerifiedAt) return link.user;

    const now = new Date();
    if (link.usedAt || link.expiresAt <= now) return null;

    await prisma.$transaction(async (tx) => {
      // Takes the link, unless another request took it a moment ago.
      const taken = await tx.authToken.updateMany({
        where: { id: link.id, usedAt: null },
        data: { usedAt: now },
      });
      if (taken.count === 0) return;
      await tx.user.updateMany({
        where: { id: link.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now, password: link.passwordHash ?? undefined },
      });
      // The account's other confirmation links stop working.
      await tx.authToken.updateMany({
        where: { userId: link.userId, kind: "VERIFY_EMAIL", usedAt: null },
        data: { usedAt: now },
      });
    });

    const user = await prisma.user.findUnique({ where: { id: link.userId } });
    return user?.emailVerifiedAt ? user : null;
  }

  return { signUp, sendConfirmation, confirmEmail };
}

module.exports = { createAccounts };
