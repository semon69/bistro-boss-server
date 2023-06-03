const express = require('express')
const app = express()
const jwt = require('jsonwebtoken');
require('dotenv').config()
const cors = require('cors')
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const port = process.env.PORT || 5000;


app.use(cors())
app.use(express.json())


app.get('/', (req, res) => {
    res.send('Boss is running')
})

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next()
    })
}


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kyulyzl.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection

        const usersCollections = client.db('bistroBoosDB').collection('users');
        const menuCollections = client.db('bistroBoosDB').collection('menu');
        const reviewsCollections = client.db('bistroBoosDB').collection('reviews');
        const cartsCollections = client.db('bistroBoosDB').collection('carts');
        const paymentCollections = client.db('bistroBoosDB').collection('payments');


        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollections.findOne(query)
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next()
        }

        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollections.find().toArray()
            res.send(result)
        })


        // collect user
        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log(user);
            const query = { email: user.email }
            const existingUser = await usersCollections.findOne(query)
            console.log('existing user', existingUser);
            if (existingUser) {
                return res.send({ message: 'user already exist' })
            }
            const result = await usersCollections.insertOne(user)
            res.send(result)
        })

        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { email: email }
            const user = await usersCollections.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollections.updateOne(filter, updateDoc)
            res.send(result)
        })


        // menu item
        app.get('/menu', async (req, res) => {
            const result = await menuCollections.find().toArray()
            res.send(result)
        })

        // review item
        app.get('/reviews', async (req, res) => {
            const result = await reviewsCollections.find().toArray()
            res.send(result)
        })

        app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollections.insertOne(newItem)
            res.send(result);
        })

        app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await menuCollections.deleteOne(query)
            res.send(result)
        })

        // cart collection
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email
            // console.log(email);
            if (!email) {
                res.send([])
            }
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            const query = { email: email }
            const result = await cartsCollections.find(query).toArray()
            res.send(result)
        })

        app.post('/carts', async (req, res) => {
            const item = req.body;
            // console.log(query);
            const result = await cartsCollections.insertOne(item)
            res.send(result)
        })

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartsCollections.deleteOne(query)
            res.send(result)
        })

        // create payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const result = await paymentCollections.insertOne(payment)
            const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
            const deleteResult = await cartsCollections.deleteMany(query)

            res.send({ result, deleteResult })
        })

        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const users = await usersCollections.estimatedDocumentCount()
            const products = await menuCollections.estimatedDocumentCount()
            const orders = await paymentCollections.estimatedDocumentCount()
            const payment = await paymentCollections.find().toArray()
            const revenue = payment.reduce((sum, payment) => sum + payment.price, 0)
            res.send({
                users, products, orders, revenue
            })
        })


        app.get('/order-stats',async (req, res) => {
            const pipeline = [
                {
                    $lookup: {
                        from: 'menu',
                        localField: 'menuItems',
                        foreignField: '_id',
                        as: 'menuItemsData'
                    }
                },
                {
                    $unwind: '$menuItemsData'
                },
                {
                    $group: {
                        _id: '$menuItemsData.category',
                        count: { $sum: 1 },
                        total: { $sum: '$menuItemsData.price' }
                    }
                },
                {
                    $project: {
                        category: '$_id',
                        count: 1,
                        total: { $round: ['$total', 2] },
                        _id: 0
                    }
                }
            ];

            const result = await paymentCollections.aggregate(pipeline).toArray()
            res.send(result)

        })


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`Boss is running on port ${port}`)
})