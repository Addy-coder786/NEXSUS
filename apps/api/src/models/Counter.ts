import mongoose, { Schema, type Model } from 'mongoose';

/** Generic atomic sequence, keyed by a string such as `task:<projectId>`. */
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter =
  (mongoose.models.Counter as Model<ICounter>) ??
  mongoose.model<ICounter>('Counter', counterSchema);

export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  if (!doc) throw new Error(`Counter ${key} could not be incremented`);
  return doc.seq;
}

export const taskCounterKey = (projectId: unknown): string => `task:${String(projectId)}`;
