require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./db/User');
const Professional = require('./db/professional');
const faceapi = require('face-api.js');
const canvas = require('canvas');

// Patch face-api.js to use the Node.js environment
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Connect to MongoDB
mongoose.connect(process.env.MONGO_DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Load Face-API models
faceapi.nets.ssdMobilenetv1.loadFromDisk(path.join(__dirname, 'models'));
faceapi.nets.faceLandmark68Net.loadFromDisk(path.join(__dirname, 'models'));
faceapi.nets.faceRecognitionNet.loadFromDisk(path.join(__dirname, 'models'));

// Middleware to authenticate JWT and check role
function authenticateJWT(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).send('Access Denied');

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).send('Invalid Token');
        req.user = user; // Attach user info to request object
        next();
    });
}

function authorize(role) {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).send('Access Denied');
        }
        next();
    };
}

// POST /upload endpoint (User registration)
app.post('/upload', upload.single('photo'), async (req, res) => {
    try {
        const { name, password, emergencyContact, bloodGroup, allergies, pastSurgery, otherMedicalConditions } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            name,
            password: hashedPassword,
            emergencyContact,
            bloodGroup,
            allergies,
            pastSurgery,
            otherMedicalConditions,
            photo: req.file.buffer
        });
        await newUser.save();
        res.status(201).send('User saved successfully');
    } catch (error) {
        res.status(500).send('Error saving user: ' + error.message);
    }
});

// POST /register-professional endpoint (Medical professional registration)
app.post('/register-professional', async (req, res) => {
    try {
        const { name, contact, doctorId, affiliatedHospital, password } = req.body;

        if (!name || !contact || !doctorId || !affiliatedHospital || !password) {
            return res.status(400).send('All fields are required.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newProfessional = new Professional({
            name,
            contact,
            doctorId,
            affiliatedHospital,
            password: hashedPassword
        });

        await newProfessional.save();
        res.status(201).send('Medical professional registered successfully');
    } catch (error) {
        res.status(500).send('Error registering professional: ' + error.message);
    }
});

// POST /login endpoint
app.post('/login', async (req, res) => {
    const { name, password, role } = req.body;
    const model = role === 'professional' ? Professional : User;

    const user = await model.findOne({ name });
    if (!user) return res.status(400).send('User not found');

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).send('Invalid password');

    const token = jwt.sign({ id: user._id, role: role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// GET /userData endpoint (User login and get data)
app.get('/userData', authenticateJWT, authorize('user'), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).send('User not found');

        res.json({
            name: user.name,
            emergencyContact: user.emergencyContact,
            bloodGroup: user.bloodGroup,
            allergies: user.allergies,
            pastSurgery: user.pastSurgery,
            otherMedicalConditions: user.otherMedicalConditions
        });
    } catch (error) {
        res.status(500).send('Error fetching user data: ' + error.message);
    }
});

//maybe include update.
app.post('/update', authenticateJWT, authorize('user'), upload.single('photo'), async (req, res) => {
    try {
        const { emergencyContact, bloodGroup, allergies, pastSurgery, otherMedicalConditions } = req.body;
        const updateFields = {
            emergencyContact,
            bloodGroup,
            allergies,
            pastSurgery,
            otherMedicalConditions
        };
        if (req.file) updateFields.photo = req.file.buffer;

        const user = await User.findByIdAndUpdate(req.user.id, updateFields, { new: true });
        res.status(200).send('User data updated successfully');
    } catch (error) {
        res.status(500).send('Error updating user data: ' + error.message);
    }
});

// GET /verify endpoint (Restricted to medical professionals)
app.get('/verify', authenticateJWT, authorize('professional'), upload.single('photo'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).send('No photo provided or invalid file.');
        }

        const img = await canvas.loadImage(req.file.buffer);

        // Detect a single face
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

        if (!detection) {
            return res.status(404).send('No face detected in the provided image.');
        }

        const inputDescriptor = detection.descriptor;

        const users = await User.find({});
        let match = null;

        for (const user of users) {
            const dbBuffer = Buffer.from(user.photo.buffer);
            const dbImg = await canvas.loadImage(dbBuffer);

            const dbDetection = await faceapi.detectSingleFace(dbImg).withFaceLandmarks().withFaceDescriptor();

            if (dbDetection) {
                const dbDescriptor = dbDetection.descriptor;
                const distance = faceapi.euclideanDistance(inputDescriptor, dbDescriptor);

                if (distance < 0.6) {
                    match = user;
                    break;
                }
            }
        }

        if (match) {
            res.json({
                name: match.name,
                emergencyContact: match.emergencyContact,
                bloodGroup: match.bloodGroup,
                allergies: match.allergies,
                pastSurgery: match.pastSurgery,
                otherMedicalConditions: match.otherMedicalConditions
            });
        } else {
            res.status(404).send('No match found');
        }
    } catch (error) {
        console.error('Error verifying user:', error);
        res.status(500).send('Error verifying user: ' + error.message || error);
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});