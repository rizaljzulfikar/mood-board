import { Schema, model, models, type Document, type Types } from "mongoose";
import { NOTE_DEFAULT_COLOR } from "../note-format";

export interface ItemDoc extends Document<Types.ObjectId> {
  project: Types.ObjectId;
  /**
   * "image" = plain picture; "link" = URL card whose objectKey is the stored
   * thumbnail; "note" = sticky note whose content is sanitized rich-text HTML
   * (objectKey is a placeholder, no storage object exists).
   */
  kind: "image" | "link" | "note";
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
  /** Non-destructive crop of the stored image, as 0..1 fractions. */
  crop: { x: number; y: number; w: number; h: number };
  /** Where an imported item came from (null for direct uploads). */
  sourceUrl: string | null;
  /** Page title for link cards. */
  title: string | null;
  siteName: string | null;
  /** User-facing label, editable on the board. */
  label: string;
  /** Rich-text HTML for note items, sanitized to the note tag whitelist. */
  content: string;
  /** Note background color, a strict `#rrggbb` hex string. */
  color: string;
  addedBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const cropSchema = new Schema(
  {
    x: { type: Number, required: true, default: 0, min: 0, max: 1 },
    y: { type: Number, required: true, default: 0, min: 0, max: 1 },
    w: { type: Number, required: true, default: 1, min: 0.02, max: 1 },
    h: { type: Number, required: true, default: 1, min: 0.02, max: 1 },
  },
  { _id: false }
);

const itemSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    kind: { type: String, enum: ["image", "link", "note"], default: "image", required: true },
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
    crop: { type: cropSchema, required: true, default: () => ({ x: 0, y: 0, w: 1, h: 1 }) },
    sourceUrl: { type: String, default: null },
    title: { type: String, default: null },
    siteName: { type: String, default: null },
    label: { type: String, default: "" },
    content: { type: String, default: "" },
    color: { type: String, default: NOTE_DEFAULT_COLOR },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

export const Item = models.Item ?? model<ItemDoc>("Item", itemSchema);
