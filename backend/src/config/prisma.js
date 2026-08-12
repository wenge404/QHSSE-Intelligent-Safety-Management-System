const { PrismaClient } = require("@prisma/client");

// Single shared instance. Creating a new PrismaClient per request will exhaust
// the database connection pool — import this module instead.
const prisma = new PrismaClient();

module.exports = prisma;
