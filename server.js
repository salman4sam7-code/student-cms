const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');

// ---------- Environment ----------
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('FATAL: MONGODB_URI environment variable is not set.');
    console.error('Set MONGODB_URI in your Render.com dashboard under Environment > Environment Variables.');
    process.exit(1);
}

const app = express();

// ---------- Middleware ----------
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'secret_key_cms',
    resave: false,
    saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Models ----------
const Course = mongoose.model('Course', new mongoose.Schema({
    name: String
}));

const Subject = mongoose.model('Subject', new mongoose.Schema({
    name: String,
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
}));

const User = mongoose.model('User', new mongoose.Schema({
    full_name: String,
    email: String,
    password: { type: String, default: '123456' },
    role: { type: String, enum: ['admin', 'staff', 'student'] },
    gender: String,
    address: String,
    profile_pic: { type: String, default: 'default.png' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    session_id: String
}));

const Attendance = mongoose.model('Attendance', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    course_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    status: String,
    date: String
}));

const Score = mongoose.model('Score', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
    score: Number
}));

const Leave = mongoose.model('Leave', new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    date: String,
    message: String,
    status: { type: String, default: 'Pending' },
    created_at: { type: Date, default: Date.now }
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
    message: String,
    type: String,
    created_at: { type: Date, default: Date.now }
}));

const Feedback = mongoose.model('Feedback', new mongoose.Schema({
    student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: String,
    created_at: { type: Date, default: Date.now }
}));

// ---------- DB Connection ----------
async function initAdmin() {
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
        await User.create({
            full_name: 'Administrator',
            email: 'admin@gmail.com',
            password: '123456',
            role: 'admin'
        });
        console.log('Default admin created: admin@gmail.com / 123456');
    }
}

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('MongoDB connected.');
        initAdmin();
    })
    .catch(err => console.error('MongoDB connection error:', err));

// ---------- Auth Middleware ----------
function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// ---------- Routes ----------
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const found = await User.findOne({ email: email, password: password });
        if (found) {
            req.session.user = found;
            res.redirect('/app?page=dashboard');
        } else {
            res.redirect('/login?error=Invalid credentials');
        }
    } catch (err) {
        res.redirect('/login?error=Database Error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ---------- Shared App Handler ----------
const appHandler = async (req, res) => {
    try {
        let success_msg = req.query.msg || '';
        const page = req.query.page || 'dashboard';
        const user = req.session.user;

        // 1. Deletion via GET query params
        if (req.query.delete && req.query.table && req.query.id) {
            const { table, id } = req.query;
            if (table === 'courses') await Course.findByIdAndDelete(id);
            else if (table === 'subjects') await Subject.findByIdAndDelete(id);
            else if (table === 'staff' || table === 'students') await User.findByIdAndDelete(id);
            return res.redirect(`/app?page=${req.query.page}&msg=Record deleted successfully.`);
        }

        // 2. POST actions
        if (req.method === 'POST') {
            switch (req.body.action) {
                case 'add_course':
                    await Course.create({ name: req.body.name });
                    success_msg = 'Course added successfully.';
                    break;
                case 'add_subject':
                    await Subject.create({ name: req.body.name, course_id: req.body.course_id });
                    success_msg = 'Subject added successfully.';
                    break;
                case 'add_staff':
                    await User.create({ ...req.body, role: 'staff' });
                    success_msg = 'Staff member added successfully.';
                    break;
                case 'add_student':
                    await User.create({ ...req.body, role: 'student' });
                    success_msg = 'Student added successfully.';
                    break;
                case 'save_attendance': {
                    const { date, course_id, subject_id, attendance } = req.body;
                    await Attendance.deleteMany({ date, subject_id, course_id });
                    if (attendance) {
                        for (const student_id of Object.keys(attendance)) {
                            await Attendance.create({
                                student_id, subject_id, course_id,
                                status: attendance[student_id], date
                            });
                        }
                    }
                    success_msg = 'Attendance saved successfully.';
                    break;
                }
                case 'save_scores': {
                    const { subject_id, score } = req.body;
                    if (score) {
                        for (const student_id of Object.keys(score)) {
                            if (score[student_id] !== '') {
                                await Score.findOneAndUpdate(
                                    { student_id, subject_id },
                                    { score: score[student_id] },
                                    { upsert: true, new: true }
                                );
                            }
                        }
                    }
                    success_msg = 'Scores saved successfully.';
                    break;
                }
                case 'apply_leave':
                    await Leave.create({
                        user_id: user._id, role: user.role,
                        date: req.body.date, message: req.body.message
                    });
                    success_msg = 'Leave application submitted.';
                    break;
                case 'update_leave':
                    await Leave.findByIdAndUpdate(req.body.leave_id, { status: req.body.status });
                    success_msg = 'Leave status updated.';
                    break;
                case 'send_notification':
                    await Notification.create({ message: req.body.message, type: req.body.type });
                    success_msg = 'Notification sent successfully.';
                    break;
                case 'send_feedback':
                    await Feedback.create({ student_id: user._id, message: req.body.message });
                    success_msg = 'Feedback submitted. Thank you!';
                    break;
            }
            return res.redirect(`/app?page=${page}&msg=${success_msg}`);
        }

        // 3. GET rendering: base data object
        const data = {
            user,
            page,
            success_msg,
            fetched_students: [],
            exam_students: [],
            existing_scores: {},
            existing_attendance: {}
        };

        // Always fetched
        data.courses = await Course.find();
        data.subjects = await Subject.find().populate('course_id');

        // Page-specific fetching
        if (page === 'dashboard') {
            data.total_students = await User.countDocuments({ role: 'student' });
            data.total_staff = await User.countDocuments({ role: 'staff' });
            data.total_courses = await Course.countDocuments();
            data.total_subjects = await Subject.countDocuments();
            data.att_count = await Attendance.countDocuments();
            if (user.role === 'student') {
                data.total_present = await Attendance.countDocuments({ student_id: user._id, status: 'Present' });
                data.total_total = await Attendance.countDocuments({ student_id: user._id });
            }
        } else if (page === 'manage_staff') {
            data.staffs = await User.find({ role: 'staff' });
        } else if (page === 'manage_students') {
            data.students = await User.find({ role: 'student' }).populate('course_id');
        } else if (page === 'manage_attendance' || page === 'take_attendance') {
            const { fetch_course, fetch_date, fetch_subject } = req.query;
            if (fetch_course && fetch_date && fetch_subject) {
                data.fetched_students = await User.find({ role: 'student', course_id: fetch_course });
                const existing = await Attendance.find({ date: fetch_date, subject_id: fetch_subject });
                existing.forEach(a => { data.existing_attendance[a.student_id.toString()] = a.status; });
                data.fetch_date = fetch_date;
                data.fetch_course = fetch_course;
                data.fetch_subject = fetch_subject;
            }
        } else if (page === 'manage_exams') {
            const { fetch_course, fetch_subject } = req.query;
            if (fetch_course && fetch_subject) {
                data.exam_students = await User.find({ role: 'student', course_id: fetch_course });
                const scores = await Score.find({ subject_id: fetch_subject });
                scores.forEach(s => { data.existing_scores[s.student_id.toString()] = s.score; });
                data.fetch_course = fetch_course;
                data.fetch_subject = fetch_subject;
            }
        } else if (page === 'notifications' && user.role === 'admin') {
            data.leaves = await Leave.find().populate('user_id').sort('-created_at');
        } else if (page === 'staff_notifs' || page === 'student_notifs') {
            data.notifs = await Notification.find({ type: user.role }).sort('-created_at');
        } else if (page === 'apply_leave') {
            data.my_leaves = await Leave.find({ user_id: user._id }).sort('-created_at');
        } else if (page === 'view_attendance' && user.role === 'staff') {
            data.logs = await Attendance.find()
                .populate('student_id').populate('subject_id')
                .sort('-date').limit(50);
        } else if (page === 'my_attendance' && user.role === 'student') {
            data.my_att = await Attendance.find({ student_id: user._id })
                .populate('subject_id').sort('-date');
        } else if (page === 'exam_results' && user.role === 'student') {
            data.scores = await Score.find({ student_id: user._id }).populate('subject_id');
        }

        res.render('app', data);
    } catch (err) {
        console.error(err);
        res.status(500).send("An error occurred while loading the page.");
    }
};

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, appHandler);

// ---------- 404 ----------
app.use((req, res) => {
    res.status(404).send(`Route Not Found: ${req.method} ${req.url}`);
});

// ---------- Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
