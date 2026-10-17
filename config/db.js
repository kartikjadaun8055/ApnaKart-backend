const express = require("express");
// const { default: mongoose } = require("mongoose");
const mongoose = require("mongoose");


const connectDB = async() =>{
    try{
       const conn =  await mongoose.connect(process.env.MONGO_URL,{

        });
        console.log('mongodb connected successfully');
    }
    catch(err){
        console.error('MongoDb connected failed :' , err.message);
        process.exit(1);
    }
};

module.exports = connectDB;