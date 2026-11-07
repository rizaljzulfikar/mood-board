import { Schema, model, models, type InferSchemaType } from "mongoose";

const itemSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    objectKey: { type: String, required: true, unique: true },
    originalName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    rotation: { type: Number, required: true, default: 0 },
    z: { type: Number, required: true, default: 0 },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

export type ItemDoc = InferSchemaType<typeof itemSchema> & {
  _id: import("mongoose").Types.ObjectId;
};

export const Item = models.Item ?? model<ItemDoc>("Item", itemSchema);
