import { SuperViewDatabase } from "../storage/database";
import { IngestService } from "./ingest";

const db = new SuperViewDatabase();
const service = new IngestService(db);
const result = service.start(process.argv[2] ? { codexHome: process.argv[2] } : {});
console.log(JSON.stringify({ jobId: result.job.id, alreadyRunning: result.alreadyRunning }, null, 2));
