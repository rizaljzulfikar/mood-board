import { Schema, model, models, type Document, type Types } from "mongoose";

export interface ItemDoc extends Document<Types.ObjectId> {
  project: Types.ObjectId;
  objectKey: string;
  originalName: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: number;
  z: number;
  addedBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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

export const Item = models.Item ?? model<ItemDoc>("Item", itemSchema);
