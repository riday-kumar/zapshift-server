const { MongoClient, ServerApiVersion } = require("mongodb");
const express = require("express");
const app = express();
var cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Zap shift is running on");
});

const uri = process.env.URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("zap_shift_db");
    const parcelCollection = db.collection("parcels");

    // parcel getting api
    app.get("/parcels", async (req, res) => {
      const query = {};

      const { email } = req.query;
      if (email) {
        query["sender-email"] = email;
      }
      //

      const allParcels = await parcelCollection.find(query).toArray();
      res.send(allParcels);
    });

    // parcel create api
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(" successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`app is running on port ${port}`);
});
