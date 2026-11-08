import { Schema, model, models, type Document, type Types } from "mongoose";

export type ConnectionStyle = "arrow" | "line";

export interface ConnectionDoc extends Document<Types.ObjectId> {
  project: Types.ObjectId;
  from: Types.ObjectId;
  to: Types.ObjectId;
  style: ConnectionStyle;
  addedBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const connectionSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    from: { type: Schema.Types.ObjectId, ref: "Group", required: true },
    to: { type: Schema.Types.ObjectId, ref: "Group", required: true },
    style: {
      type: String,
      required: true,
      enum: ["arrow", "line"],
      default: "arrow",
    },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

export const Connection =
  models.Connection ?? model<ConnectionDoc>("Connection", connectionSchema);
