import { Schema, model, models, type Document, type Types } from "mongoose";

export interface GroupDoc extends Document<Types.ObjectId> {
  project: Types.ObjectId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  addedBy: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    label: { type: String, default: "", maxLength: 120 },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true, min: 1 },
    height: { type: Number, required: true, min: 1 },
    z: { type: Number, required: true, default: 0 },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

export const Group = models.Group ?? model<GroupDoc>("Group", groupSchema);
