const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const app = express();
var cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const stripe = require("stripe")(process.env.STRIPE_SECRECT);
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./zapshift-admin-sdk.json");
const { getAuth } = require("firebase-admin/auth");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const generateTrackingId = () => {
  // random hex string
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();

  // current timestamp
  const timestamp = Date.now().toString().slice(-6);

  return `TRK-${timestamp}-${randomPart}`;
};

// middleware
app.use(cors());
app.use(express.json());

const verityFBToken = (req, res, next) => {
  const token = req.headers.authorization;
  const idToken = token.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "unauthorized user" });
  }

  getAuth()
    .verifyIdToken(idToken)
    .then((decodeToken) => {
      console.log(decodeToken);
      req.decodedEmail = decodeToken.email;
      next();
    })
    .catch((err) => {
      return res.status(401).send({ message: "unauthorized access" });
    });
};

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
    const paymentCollection = db.collection("payments");

    // parcel getting api
    app.get("/parcels", async (req, res) => {
      const query = {};

      const { email } = req.query;
      if (email) {
        query["sender-email"] = email;
      }

      const options = { sort: { createdAt: -1 } };

      const allParcels = await parcelCollection.find(query, options).toArray();
      res.send(allParcels);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    // parcel create api
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      // parcel created time
      parcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // parcel delete api
    app.delete("/parcel/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      if (query.email) {
        query["sender-email"] = req.query.email;
      }

      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    // payment success
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
      const transactionId = session.payment_intent;
      const query = { transactionId };

      const paymentExists = await paymentCollection.findOne(query);
      console.log(paymentExists);
      if (paymentExists) {
        return res.send({
          message: "already exists",
          transactionId: transactionId,
          trackingId: paymentExists.trackingId,
        });
      }

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const trackingId = generateTrackingId();
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const options = { upsert: true };
        const result = await parcelCollection.updateOne(query, update, options);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }
    });

    // all payment get for a user
    app.get("/payments", verityFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log("headers", req.headers);

      if (email) {
        query.customerEmail = email;
        // check email address
        if (email != req.decodedEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      const result = await paymentCollection.find(query).toArray();
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
