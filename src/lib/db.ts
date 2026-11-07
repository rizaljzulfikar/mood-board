/** Cached Mongoose connection (survives dev-server hot reloads). */
import mongoose from "mongoose";
import { env } from "./env";

type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as unknown as { __mongoose?: MongooseCache };
const cache: MongooseCache =
  globalForMongoose.__mongoose ?? (globalForMongoose.__mongoose = { conn: null, promise: null });

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(env("MONGODB_URI"), {
      serverSelectionTimeoutMS: 5000,
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
