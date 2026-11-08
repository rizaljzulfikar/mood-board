import { Schema, model, models, type Document, type Types } from "mongoose";

export type UserRole = "superadmin" | "user";

export interface UserDoc extends Document<Types.ObjectId> {
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "user"], default: "user", index: true },
    mustChangePassword: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = models.User ?? model<UserDoc>("User", userSchema);
