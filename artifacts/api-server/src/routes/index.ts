import { Router, type IRouter } from "express";
import healthRouter from "./health";
import salamaParkRouter from "./salama-park";
import salamaParkGeoRouter from "./salama-park-geo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(salamaParkRouter);
router.use(salamaParkGeoRouter);

export default router;
