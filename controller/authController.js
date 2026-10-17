const User = require('../model/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmail = require("../utils/senEmail");



const generateToken = (id) =>{
    return jwt.sign({id}, process.env.JWT_SECRET,{expiresIn:'30d'});

}

// Register a new user

const registerUser = async(req , res) =>{
    const{name , email , password} = req.body;

    try{
        const existingUser = await User.findOne({email});
        if(existingUser){
            return res.status(400).json({message:'User already exists'});
        }
        //1st hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        //2nd jwt implement
        //3rd otp sending for verificartion
        //4th welcome mail sent for user


        const user = await User.create({
            name,
            email,
            password: hashedPassword
        });
        if(user){
            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            const message = 
            `Welcome to ApnaKart , ${name}! Thank you for registering with us. we are excited to have you as part of our community
            Your OTP for ApnaKart registration is : ${otp}`;

            try {
                await sendEmail(email,'Welcome to ApnaKart - Your OTP for Registration', message);
            } catch (emailError) {
                console.error("Welcome email failed:", emailError);
            }

            res.status(201).json({
                message: 'User registered successfully. Please check your email for the OTP. ',
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                token: generateToken(user._id)

            });

        }else{
            res.status(400).json({
                message: 'Invalid user data'
            });
        }
    }catch(err){
         console.error("Register error" , err);
        res.status(500).json({message: 'server error'});
    }
};

// login  user

const loginUser = async(req , res) =>{
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    try{
        const user = await User.findOne({ email }).select('+password');

        if(user &&(await bcrypt.compare(password, user.password))){
            if (user.emailVerificationPending) {
                return res.status(403).json({
                    message: 'Verify your email before signing in.',
                    code: 'EMAIL_NOT_VERIFIED',
                    email: user.email
                });
            }
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                token: generateToken(user._id)

            });

        }
        else{
            res.status(400).json({message:'Invalid email or password'});

        }
    }
    catch(error){
        res.status(500).json({
            message:'server error'
        });

    }
};

const getUsers = async(req, res) =>{
    try{
        const users = await User.find({}).select('-password');
        res.json(users);
    }
    catch(error){
       
        res.status(500).json({message:'server error'});
    }

};

module.exports ={registerUser, loginUser, getUsers};