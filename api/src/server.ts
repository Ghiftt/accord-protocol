import express from "express";
import { demoRouter } from "./routes/demo";

const app = express();
app.use(express.json());
app.use("/demo", demoRouter);

const port = Number(process.env.PORT || 3002);

app.listen(port, () => {
  console.log(`ACCORD demo API listening on :${port}`);
});