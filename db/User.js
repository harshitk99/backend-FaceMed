const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    password: { type: String, required: true },
    emergencyContact: { type: String, required: true },
    bloodGroup: { type: String, required: true },
    allergies: { type: String },
    pastSurgery: { type: String },
    otherMedicalConditions: { type: String },
    photo: { type: Buffer, required: true }
});

// Hash the password before saving
UserSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

const User = mongoose.model('User', UserSchema);
module.exports = User;
