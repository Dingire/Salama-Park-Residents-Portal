import { Router, type IRouter } from "express";
import healthRouter from "./health";
import salamaParkRouter from "./salama-park";

const router: IRouter = Router();

router.use(healthRouter);
router.use(salamaParkRouter);

export default router;
