import { Schema, model, models, type Document, type Types } from "mongoose";

export interface ItemDoc extends Document<Types.ObjectId> {
  project: Types.ObjectId;
  /** "image" = plain picture; "link" = URL card whose objectKey is the stored thumbnail. */
  kind: "image" | "link";
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
  /** Where an imported item came from (null for direct uploads). */
  sourceUrl: string | null;
  /** Page title for link cards. */
  title: string | null;
  siteName: string | null;
  /** User-facing label, editable on the board. */
  label: string;
  addedBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    kind: { type: String, enum: ["image", "link"], default: "image", required: true },
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
    sourceUrl: { type: String, default: null },
    title: { type: String, default: null },
    siteName: { type: String, default: null },
    label: { type: String, default: "" },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

export const Item = models.Item ?? model<ItemDoc>("Item", itemSchema);
