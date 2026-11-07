import { Schema, model, models, type Document, type Types } from "mongoose";

export interface ProjectDoc extends Document<Types.ObjectId> {
  name: string;
  owner: Types.ObjectId;
  members: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    members: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
  },
  { timestamps: true }
);

export const Project = models.Project ?? model<ProjectDoc>("Project", projectSchema);
