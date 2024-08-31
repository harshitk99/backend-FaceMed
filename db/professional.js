const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ProfessionalSchema = new mongoose.Schema({
    name: { type: String, required: true },
    contact: { type: String, required: true },
    doctorId: { type: String, required: true },
    affiliatedHospital: { type: String, required: true },
    password: { type: String, required: true }
});

// Hash the password before saving
ProfessionalSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

const Professional = mongoose.model('Professional', ProfessionalSchema);
module.exports = Professional;
