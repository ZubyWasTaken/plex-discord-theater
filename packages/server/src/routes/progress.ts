import { Router, type Request, type Response } from "express";
import { getSessionUserId } from "../middleware/auth.js";
import { getProgress, upsertProgress, deleteProgress } from "../services/progress.js";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ items: getProgress(userId) });
});

router.put("/", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { ratingKey, title, thumb, type, parentTitle, parentIndex, index, position, duration } = req.body;
  if (!ratingKey || !title || position == null || duration == null) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  upsertProgress(userId, { ratingKey, title, thumb, type, parentTitle, parentIndex, index, position, duration });
  res.json({ ok: true });
});

router.delete("/:ratingKey", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  deleteProgress(userId, String(req.params.ratingKey));
  res.json({ ok: true });
});

export default router;
